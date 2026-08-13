/**
 * POST /api/pages/{slug}/cancel — 予約ページを非アクティブにする（軽実装）。
 *   isActive=false。既に false でも 200。存在しなければ 404。
 *   あわせて、リンク発行時に張った「自分用の仮押さえ」が残っていれば全部解除し（degrade-safe）、
 *   相手側の本物のEvent/Holdも全部cancelled/releasedにする（degrade-safe。これをしないと
 *   /unconfirmed の一覧からページ取消後も消えずに残り続けるバグになる）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { assertValidSlug } from '@/service/security';
import { requireSessionUserId } from '@/service/auth/session';
import { releaseAllSelfHoldsForPage, cancelRealEventsForPage } from '@/service/booking';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が必要です');
    assertValidSlug(slug);
    // slug は相手に配るURL(/b/{slug})の一部＝実質公開値のため、
    // ログインしていれば誰でも叩けてしまう。所有者本人か必ず確認する（破壊的操作のため）。
    const me = await requireSessionUserId();
    const repo = getRepository();
    const existing = await repo.getPageBySlug(slug);
    if (!existing) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    if (existing.organizerId !== me) {
      throw new ServiceError('FORBIDDEN', 'このページを操作する権限がありません');
    }
    const page = await repo.deactivatePageBySlug(slug);
    if (!page) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    const now = Date.now();
    await releaseAllSelfHoldsForPage(repo, page, now);
    await cancelRealEventsForPage(repo, page, now);
    return NextResponse.json({ page });
  } catch (e) {
    return jsonError(e);
  }
}
