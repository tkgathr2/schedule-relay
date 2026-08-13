/**
 * POST /api/pages — 予約ページ作成（§14）。
 * body: { type, slug, settings, candidates?: {start,end}[] }
 *   candidates を渡すと：
 *    ①settings.candidates として保存し、相手に見せる空き枠を「この候補リストそのもの」に
 *      固定する（社長要望2026-08-13：/propose で選んだ候補と、相手が実際に選べる候補を一致させる。
 *      未指定なら従来通り営業時間グリッドからの自動列挙＝T1空き時間リンク相当のまま）。
 *    ②選んだ候補**全部**に、主催者カレンダー上で [調整中] の仮押さえを即座に作る
 *      （社長要望2026-08-13：相手に見せる候補と自分用仮押さえを完全一致させる。
 *      以前は日ごとに代表1件へ間引いていたが、それだと「候補として出しているのに
 *      自分のカレンダーには一部しか反映されていない」食い違いになるため撤廃した。
 *      件数の暴走はcreateSelfHoldsForPage内のMAX_SELF_HOLD_SLOTSで最終的に歯止めする・degrade-safe）。
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
import { jsonError, slotFromDto, slotToDto, serverNow } from '@/service/http';
import { rateLimit } from '@/service/rate-limit';
import { assertValidSlug } from '@/service/security';
import { requireSessionUserId } from '@/service/auth/session';
import { createSelfHoldsForPage } from '@/service/booking';

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

    const rawSettings = (body.settings && typeof body.settings === 'object' ? body.settings : {}) as Record<
      string,
      unknown
    >;
    const slots = Array.isArray(body.candidates)
      ? body.candidates.map((c) => slotFromDto(c)).filter((s): s is { start: number; end: number } => !!s)
      : [];
    const settings: Record<string, unknown> = { ...rawSettings };
    if (slots.length > 0) settings.candidates = slots.map(slotToDto);

    const page = await repo.createPage({
      organizerId,
      slug,
      type,
      settings,
    });

    if (slots.length > 0) {
      // degrade-safe：仮押さえの一部/全部が失敗してもページ作成自体は成功として返す。
      await createSelfHoldsForPage(repo, page, slots, serverNow(body.now)).catch(() => {});
    }

    return NextResponse.json({ page }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
