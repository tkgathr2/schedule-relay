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
import { proposeSlots, splitBusyIntervalsByTitle } from '@/service/propose';
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

    const rawPeriodStart = parseTime(body.periodStart);
    const periodEnd = parseTime(body.periodEnd);
    if (rawPeriodStart === null) throw new ServiceError('VALIDATION', 'periodStart が不正です');
    if (periodEnd === null) throw new ServiceError('VALIDATION', 'periodEnd が不正です');
    if (periodEnd <= rawPeriodStart) throw new ServiceError('VALIDATION', 'periodEnd は periodStart より後である必要があります');
    // periodStart が過去日時でも、実際に生成する候補は必ず「今」以降にする
    // （社長指摘：期間の開始日を過去に設定できてしまい、過去日時の候補が生成されていた問題の修正。
    //  クライアント側の<input type="date" min>は直接入力で回避できるため、ここで最終防御する）。
    const periodStart = Math.max(rawPeriodStart, Date.now());

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
      // 未指定なら proposeSlots 側の既定（durationMinutesと同じgrid＝重複候補ゼロ）に委ねる。
      // ここで15分固定を渡すと、60分等の会議で15分刻みの重複候補が大量発生し、
      // maxSlotsに序盤の数日だけで達して後半の日程（土日等）に候補が到達しなくなる。
      gridMinutes: typeof body.gridMinutes === 'number' ? body.gridMinutes : undefined,
      workingHours,
      bufferBeforeMin: typeof body.bufferBeforeMin === 'number' ? body.bufferBeforeMin : 0,
      bufferAfterMin: typeof body.bufferAfterMin === 'number' ? body.bufferAfterMin : 0,
      minNoticeMin: typeof body.minNoticeMin === 'number' ? body.minNoticeMin : 0,
      maxSlots: typeof body.maxSlots === 'number' ? body.maxSlots : 10,
      busy,
    });

    const busyByCalendarDto = splitBusyIntervalsByTitle(busyByCalendar, titlesByCalendar);

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
