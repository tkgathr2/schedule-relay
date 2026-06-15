/**
 * GET /api/confirmations?organizerId=<id>&from=YYYY-MM-DD
 *   確定済の予定一覧（/confirmed 画面のデータ源）。
 *   - organizerId 指定時：その主催者の確定一覧。
 *   - from 指定時：start >= from の予定のみ。YYYY-MM-DD（その日の00:00 JST）として解釈。
 *   - 並び順は start 降順。
 *   - 関連 BookingPage（settings.title）を join して返す。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseDateMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    throw new ServiceError('VALIDATION', 'from は YYYY-MM-DD で指定してください');
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // JST 0:00 → UTC = (00:00 JST) - 9h
  const utcMidnight = Date.UTC(y, mo - 1, d);
  return utcMidnight - JST_OFFSET_MS;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const organizerId = url.searchParams.get('organizerId') ?? undefined;
    const fromMs = parseDateMs(url.searchParams.get('from'));

    const repo = getRepository();
    const confs = await repo.listConfirmationsFiltered({ organizerId, fromMs });

    // Event → BookingPage を join（タイトル取得）
    const eventMap = new Map<string, unknown>();
    const pageMap = new Map<string, unknown>();
    for (const c of confs) {
      if (!eventMap.has(c.eventId)) {
        const ev = await repo.getEvent(c.eventId);
        if (ev) {
          eventMap.set(c.eventId, ev);
          if (!pageMap.has(ev.pageId)) {
            const p = await repo.getPageById(ev.pageId);
            if (p) pageMap.set(ev.pageId, p);
          }
        }
      }
    }
    const enriched = confs.map((c) => {
      const ev = eventMap.get(c.eventId) as { pageId: string } | undefined;
      const page = ev ? pageMap.get(ev.pageId) : null;
      return { ...c, event: ev ?? null, page: page ?? null };
    });
    return NextResponse.json({ confirmations: enriched });
  } catch (e) {
    return jsonError(e);
  }
}
