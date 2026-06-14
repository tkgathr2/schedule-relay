/**
 * GET /api/pages/{slug}/availability — 空き枠算出（§14）。
 * 任意 query: ?now=<ISO|ms>（テスト/プレビュー用。既定はサーバ現在時刻）。
 */
import { NextResponse } from 'next/server';
import { getMemoryRepository } from '@/repo/memory';
import { availabilityForPage } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError, slotToDto } from '@/service/http';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const repo = getMemoryRepository();
    const page = await repo.getPageBySlug(slug);
    if (!page || !page.isActive) throw new ServiceError('NOT_FOUND', '予約ページが見つかりません');

    const nowParam = new URL(req.url).searchParams.get('now');
    let now = Date.now();
    if (nowParam) {
      const parsed = /^\d+$/.test(nowParam) ? Number(nowParam) : Date.parse(nowParam);
      if (!Number.isNaN(parsed)) now = parsed;
    }

    const slots = availabilityForPage(page, now).map(slotToDto);
    return NextResponse.json({ slug, now: new Date(now).toISOString(), slots });
  } catch (e) {
    return jsonError(e);
  }
}
