/**
 * GET /api/pages/{slug} — 予約ページの全設定を取得する（主催者本人のみ・編集画面のプリフィル用）。
 * PATCH /api/pages/{slug} — 予約ページの設定（タイトル・打合せ時間・営業時間・バッファ・直前ブロック）を
 * 更新する（主催者本人のみ・部分更新＝既存settingsにマージ）。
 *   body.candidates を渡すと：
 *    ①settings.candidates を新しい候補リストで丸ごと置き換える（社長要望2026-08-13：相手に見せる
 *      候補を、この候補リストそのものに固定する。/api/pages のPOSTと同じ仕様）。
 *    ②自分用仮押さえ（[調整中]）も、日ごとに代表1件へ間引いた新しい候補セットで作り直す
 *      （社長指摘：編集で候補を変えても古い仮押さえがカレンダーに残ったまま反映されない問題の修正）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { ServiceError } from '@/service/errors';
import { jsonError, slotFromDto, slotToDto, serverNow } from '@/service/http';
import { assertValidSlug } from '@/service/security';
import { requireSessionUserId } from '@/service/auth/session';
import { createSelfHoldsForPage, releaseAllSelfHoldsForPage, pickOneCandidatePerDay } from '@/service/booking';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が必要です');
    assertValidSlug(slug);
    const me = await requireSessionUserId();
    const repo = getRepository();
    const page = await repo.getPageBySlug(slug);
    if (!page) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    if (page.organizerId !== me) {
      throw new ServiceError('FORBIDDEN', 'このページを操作する権限がありません');
    }
    return NextResponse.json({ page });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が必要です');
    assertValidSlug(slug);
    // slug は相手に配るURL(/b/{slug})の一部＝実質公開値のため、
    // ログインしていれば誰でも叩けてしまう。所有者本人か必ず確認する。
    const me = await requireSessionUserId();
    const repo = getRepository();
    const existing = await repo.getPageBySlug(slug);
    if (!existing) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    if (existing.organizerId !== me) {
      throw new ServiceError('FORBIDDEN', 'このページを操作する権限がありません');
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const prev = (existing.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<
      string,
      unknown
    >;
    const next: Record<string, unknown> = { ...prev };

    if (typeof body.title === 'string') next.title = body.title;
    if (
      typeof body.duration_minutes === 'number' &&
      Number.isFinite(body.duration_minutes) &&
      body.duration_minutes > 0 &&
      body.duration_minutes <= 24 * 60
    ) {
      next.duration_minutes = body.duration_minutes;
    }
    if (
      typeof body.min_notice_minutes === 'number' &&
      Number.isFinite(body.min_notice_minutes) &&
      body.min_notice_minutes >= 0
    ) {
      next.min_notice_minutes = body.min_notice_minutes;
    }
    if (body.buffer_minutes && typeof body.buffer_minutes === 'object') {
      const b = body.buffer_minutes as Record<string, unknown>;
      next.buffer_minutes = {
        before: typeof b.before === 'number' ? b.before : 0,
        after: typeof b.after === 'number' ? b.after : 0,
      };
    }
    if (body.working_hours && typeof body.working_hours === 'object') {
      next.working_hours = body.working_hours;
    }

    const hasCandidates = Array.isArray(body.candidates);
    const slots = hasCandidates
      ? (body.candidates as unknown[]).map((c) => slotFromDto(c)).filter((s): s is { start: number; end: number } => !!s)
      : [];
    if (hasCandidates) next.candidates = slots.map(slotToDto);

    const page = await repo.updatePageSettingsBySlug(slug, next);
    if (!page) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);

    if (hasCandidates) {
      // 既存の自分用仮押さえを全部解放してから、日ごとに代表1件へ間引いた新しい候補セットで作り直す（degrade-safe）。
      const now = serverNow(body.now);
      await releaseAllSelfHoldsForPage(repo, page, now).catch(() => {});
      await createSelfHoldsForPage(repo, page, pickOneCandidatePerDay(slots), now).catch(() => {});
    }

    return NextResponse.json({ page });
  } catch (e) {
    return jsonError(e);
  }
}
