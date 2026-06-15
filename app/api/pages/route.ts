/**
 * POST /api/pages — 予約ページ作成（§14）。
 * body: { organizerId, type, slug, settings }
 *
 * GET /api/pages?organizerId=<id> — 予約ページ一覧（ダッシュボード用・/links 画面のデータ源）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import type { AdjustmentType } from '@/domain/types';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

const VALID_TYPES: AdjustmentType[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const organizerId = url.searchParams.get('organizerId') ?? '';
    if (!organizerId) {
      throw new ServiceError('VALIDATION', 'organizerId は必須です');
    }
    const repo = getRepository();
    const pages = await repo.listPagesByOrganizer(organizerId);
    return NextResponse.json({ pages });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const organizerId = typeof body.organizerId === 'string' ? body.organizerId : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const type = body.type as AdjustmentType;
    if (!organizerId) throw new ServiceError('VALIDATION', 'organizerId は必須です');
    if (!slug) throw new ServiceError('VALIDATION', 'slug は必須です');
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
