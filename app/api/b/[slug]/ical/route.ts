/**
 * GET /api/b/[slug]/ical?from=&to=
 * 公開予約ページの「空き枠」を iCalendar (.ics) としてダウンロードする。
 *
 * クエリ:
 *  - from: ISO or ms（既定: 現在時刻）
 *  - to:   ISO or ms（既定: from + horizonDays）
 * レスポンス:
 *  - Content-Type: text/calendar; charset=utf-8
 *  - Content-Disposition: attachment; filename="<slug>.ics"
 *
 * 設計：availability ルートと同じく liveAvailabilityForPage を使って空き枠を取り、
 * 1 枠 = 1 VEVENT に展開する。slug は security.ts の assertValidSlug で検証。
 * 失敗系は jsonError でフォールバック（クライアントは .ics 期待時のみダウンロード）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { liveAvailabilityForPage, resolveSettings } from '@/service/booking';
import { googleConfigFromEnv, googleFreeBusy } from '@/service/calendar/google';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { buildIcs, type IcsEvent } from '@/service/ical';
import { assertValidSlug } from '@/service/security';
import type { Interval } from '@/domain/types';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    assertValidSlug(slug);

    const repo = getRepository();
    const page = await repo.getPageBySlug(slug);
    if (!page || !page.isActive) {
      throw new ServiceError('NOT_FOUND', '予約ページが見つかりません');
    }

    const url = new URL(req.url);
    const now = Date.now();
    const from = parseTime(url.searchParams.get('from')) ?? now;
    const cfg = resolveSettings(page.settings);
    const to = parseTime(url.searchParams.get('to')) ?? from + cfg.horizonDays * DAY_MS;
    if (to <= from) {
      throw new ServiceError('VALIDATION', 'to は from より後である必要があります');
    }

    // Google 連携：未設定/失敗時は busy=[] でdegrade（availability ルートと同様）。
    let externalBusy: Interval[] = [];
    const gcfg = googleConfigFromEnv();
    if (gcfg) {
      try {
        externalBusy = await googleFreeBusy(gcfg, from, to);
      } catch {
        externalBusy = [];
      }
    }

    const slots = await liveAvailabilityForPage(repo, page, from, externalBusy);
    const inRange = slots.filter((s) => {
      const ss = typeof s.start === 'number' ? s.start : new Date(s.start).getTime();
      const ee = typeof s.end === 'number' ? s.end : new Date(s.end).getTime();
      return ss >= from && ee <= to;
    });

    const raw = (page.settings && typeof page.settings === 'object' ? page.settings : {}) as Record<string, unknown>;
    const title = typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : slug;

    const events: IcsEvent[] = inRange.map((s, idx) => {
      const startMs = typeof s.start === 'number' ? s.start : new Date(s.start).getTime();
      const endMs = typeof s.end === 'number' ? s.end : new Date(s.end).getTime();
      return {
        uid: `b-${slug}-${startMs}-${idx}@schedule-relay`,
        start: new Date(startMs),
        end: new Date(endMs),
        summary: `【空き枠】${title}`,
        description: `空き枠（${cfg.durationMin}分）／ ${title}`,
      };
    });

    const ics = buildIcs(events, { calName: `${title}（空き枠）` });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
