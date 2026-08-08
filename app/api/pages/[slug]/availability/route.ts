/**
 * GET /api/pages/{slug}/availability — 空き枠算出（§14）。
 * 任意 query: ?now=<ISO|ms>（テスト/プレビュー用。既定はサーバ現在時刻）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { liveAvailabilityForPage, resolveSettings } from '@/service/booking';
import { googleFreeBusy } from '@/service/calendar/google';
import { googleConfigForUserId } from '@/service/calendar/tenant';
import { ServiceError } from '@/service/errors';
import { jsonError, slotToDto } from '@/service/http';
import { assertValidSlug } from '@/service/security';
import type { Interval } from '@/domain/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    assertValidSlug(slug);
    const repo = getRepository();
    const page = await repo.getPageBySlug(slug);
    if (!page || !page.isActive) throw new ServiceError('NOT_FOUND', '予約ページが見つかりません');

    const nowParam = new URL(req.url).searchParams.get('now');
    let now = Date.now();
    if (nowParam) {
      const parsed = /^\d+$/.test(nowParam) ? Number(nowParam) : Date.parse(nowParam);
      if (!Number.isNaN(parsed)) now = parsed;
    }

    const cfg = resolveSettings(page.settings);

    // Googleカレンダー連携：この API はゲスト（未ログイン）が公開ページから叩くので、
    // セッションではなく **このページの主催者** のトークンで freebusy を取る。
    // 未連携/失敗時は [] でdegrade（受付時間帯ベースの空きは出る）。
    let externalBusy: Interval[] = [];
    const gcfg = await googleConfigForUserId(page.organizerId);
    if (gcfg) {
      externalBusy = await googleFreeBusy(gcfg, now, now + cfg.horizonDays * DAY_MS);
    }

    const slots = (await liveAvailabilityForPage(repo, page, now, externalBusy)).map(slotToDto);
    const raw = (page.settings && typeof page.settings === 'object' ? page.settings : {}) as Record<string, unknown>;
    const meta = {
      title: typeof raw.title === 'string' ? raw.title : page.slug,
      description: typeof raw.description === 'string' ? raw.description : '',
      durationMin: cfg.durationMin,
      tz: cfg.workingHours.tz,
      organizerId: page.organizerId,
    };
    return NextResponse.json({ slug, now: new Date(now).toISOString(), meta, slots });
  } catch (e) {
    return jsonError(e);
  }
}
