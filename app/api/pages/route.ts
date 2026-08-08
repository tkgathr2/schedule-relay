/**
 * POST /api/pages — 予約ページ作成（§14）。
 * body: { type, slug, settings }
 *
 * GET /api/pages — 予約ページ一覧（ダッシュボード用・/links 画面のデータ源）。
 *
 * 🔒 organizerId は**セッションから引く**。クエリ/ボディで渡された organizerId は無視する。
 *    （2026-08-08 セキュリティレビュー H1：他人の organizerId を騙れる IDOR の修正）
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import type { AdjustmentType } from '@/domain/types';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { rateLimit } from '@/service/rate-limit';
import { assertValidSlug } from '@/service/security';
import { requireSessionUserId } from '@/service/auth/session';

const VALID_TYPES: AdjustmentType[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    // クエリの organizerId は受け付けない（他人のリンク一覧を覗けてしまうため）。
    const organizerId = await requireSessionUserId();
    const repo = getRepository();
    const all = await repo.listPagesByOrganizer(organizerId);
    // 既定で isActive=true のみ返す。?includeInactive=1 で全件。
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const pages = includeInactive ? all : all.filter((p) => p.isActive);
    return NextResponse.json({ pages });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Rate limit: 10 req / 300s / IP（slug 総当り・スパム作成抑止）
    const blocked = rateLimit(req, 'pages:create', 10, 300);
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    // body.organizerId は無視してセッションの user.id を使う。
    // （他人の User.id で予約ページを作られると、その公開ページ経由で
    //   被害者の Google カレンダーの freebusy が読めてしまう）
    const organizerId = await requireSessionUserId();
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const type = body.type as AdjustmentType;
    if (!slug) throw new ServiceError('VALIDATION', 'slug は必須です');
    assertValidSlug(slug);
    if (!VALID_TYPES.includes(type)) throw new ServiceError('VALIDATION', 'type が不正です');

    const repo = getRepository();
    if (await repo.getPageBySlug(slug)) {
      throw new ServiceError('VALIDATION', `slug は既に使われています: ${slug}`);
    }
    const page = await repo.createPage({
      organizerId,
      slug,
      type,
      settings: body.settings ?? {},
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
