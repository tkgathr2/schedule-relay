/**
 * POST /api/availability/propose — Spirの「候補を自動抽出」相当。
 * body:
 *   {
 *     calendarIds: string[],               // 予定を考慮するGoogleカレンダーID（複数）
 *     periodStart: ISO|ms, periodEnd: ISO|ms,
 *     durationMinutes: number,             // 15/30/45/60/90/120
 *     gridMinutes?: number,                // 既定15
 *     workingHours?: WorkingHours,         // 未指定なら平日09-18 JST
 *     bufferBeforeMin?, bufferAfterMin?, minNoticeMin?,
 *     maxSlots?: number                    // 既定10
 *   }
 * 応答: { slots: [{start, end}], busy: [{start,end}], periodStart, periodEnd }
 *
 * env未設定/Google失敗時は busy=[] でdegrade-safe（営業時間ベースの候補を返す）。
 */
import { NextResponse } from 'next/server';
import { googleFreeBusy, googleFreeBusyByCalendar, googleEventTitlesByCalendar } from '@/service/calendar/google';
import { googleConfigForCurrentUser } from '@/service/calendar/tenant';
import { proposeSlots } from '@/service/propose';
import { ServiceError } from '@/service/errors';
import { jsonError, slotToDto } from '@/service/http';
import { rateLimit } from '@/service/rate-limit';
import type { WorkingHours } from '@/domain/working-hours';

function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return Number(v);
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Rate limit: 30 req / 60s / IP（Google Calendar API 浪費/DoS 抑止）
    const blocked = rateLimit(req, 'availability:propose', 30, 60);
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const periodStart = parseTime(body.periodStart);
    const periodEnd = parseTime(body.periodEnd);
    if (periodStart === null) throw new ServiceError('VALIDATION', 'periodStart が不正です');
    if (periodEnd === null) throw new ServiceError('VALIDATION', 'periodEnd が不正です');
    if (periodEnd <= periodStart) throw new ServiceError('VALIDATION', 'periodEnd は periodStart より後である必要があります');

    const duration = Number(body.durationMinutes);
    if (!Number.isFinite(duration) || duration < 1 || duration > 24 * 60) {
      throw new ServiceError('VALIDATION', 'durationMinutes が不正です');
    }

    const calendarIds = Array.isArray(body.calendarIds)
      ? body.calendarIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [];

    const workingHours = body.workingHours as WorkingHours | undefined;

    // Googleカレンダー連携：**ログイン中の本人**のトークンで busy 取得。
    // （この API は主催者専用＝middleware が未ログインを 401 で弾く）
    let busy: { start: number; end: number }[] = [];
    let busyByCalendar: Record<string, { start: number; end: number }[]> = {};
    let titlesByCalendar: Record<string, { start: number; end: number; title: string }[]> = {};
    const cfg = await googleConfigForCurrentUser();
    if (cfg && calendarIds.length > 0) {
      // freebusy（マージ版）／freebusy（カレンダーごと）／events.list（タイトル）を並列実行
      const [merged, byCal, titles] = await Promise.all([
        googleFreeBusy(cfg, periodStart, periodEnd, { calendarIds }),
        googleFreeBusyByCalendar(cfg, periodStart, periodEnd, calendarIds),
        googleEventTitlesByCalendar(cfg, periodStart, periodEnd, calendarIds),
      ]);
      busy = merged;
      busyByCalendar = byCal;
      titlesByCalendar = titles;
    }

    const slots = proposeSlots({
      periodStart,
      periodEnd,
      durationMinutes: duration,
      gridMinutes: typeof body.gridMinutes === 'number' ? body.gridMinutes : 15,
      workingHours,
      bufferBeforeMin: typeof body.bufferBeforeMin === 'number' ? body.bufferBeforeMin : 0,
      bufferAfterMin: typeof body.bufferAfterMin === 'number' ? body.bufferAfterMin : 0,
      minNoticeMin: typeof body.minNoticeMin === 'number' ? body.minNoticeMin : 0,
      maxSlots: typeof body.maxSlots === 'number' ? body.maxSlots : 10,
      busy,
    });

    // busyByCalendar に title を重ねる：busy 区間と重なる events.list の summary を持ってくる。
    // events.list の方が rich（title 付き）なので、busy 単独区間より優先で title を埋める。
    const busyByCalendarDto: Record<string, { start: string; end: string; title?: string }[]> = {};
    for (const calId of Object.keys(busyByCalendar)) {
      const intervals = busyByCalendar[calId] ?? [];
      const titles = titlesByCalendar[calId] ?? [];
      busyByCalendarDto[calId] = intervals.map((iv) => {
        const hit = titles.find((t) => t.start < iv.end && t.end > iv.start);
        const dto: { start: string; end: string; title?: string } = {
          start: new Date(iv.start).toISOString(),
          end: new Date(iv.end).toISOString(),
        };
        if (hit && hit.title) dto.title = hit.title;
        return dto;
      });
    }

    return NextResponse.json({
      slots: slots.map(slotToDto),
      busy: busy.map(slotToDto),
      busyByCalendar: busyByCalendarDto,
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
      calendarIds,
    });
  } catch (e) {
    return jsonError(e);
  }
}
