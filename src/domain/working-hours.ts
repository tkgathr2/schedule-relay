/**
 * 営業時間（working_hours）の「曜日×TZ → UTCウィンドウ」展開（仕様 §10/§19）。
 *
 * 仕様 §19：固定オフセット禁止＝IANA TZ DB で DST 境界を解決する。
 * ここでは Intl.DateTimeFormat（IANA TZ）でローカル壁時計⇔UTC を決定論的に変換し、
 * availability.ts に渡す UTC ウィンドウ（Interval[]）を生成する。
 */
import type { Interval } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 曜日別の受付時間帯。各値は ["09:00","18:00"] のような HH:MM ペアの平坦配列（空=休業）。
 *
 * 個別曜日（mon〜fri）を指定すればそちらが優先される（例：水曜だけ休みにする、
 * 木曜だけ短縮する等）。個別指定が無い曜日は mon_fri にフォールバックする
 * （既存データ・「平日は一括」設定との後方互換のため）。
 */
export interface WorkingHours {
  /** IANA タイムゾーン（例: "Asia/Tokyo"）。 */
  readonly tz: string;
  /** 月〜金の既定値（個別曜日が未指定のときのフォールバック）。 */
  readonly mon_fri?: readonly string[];
  readonly mon?: readonly string[];
  readonly tue?: readonly string[];
  readonly wed?: readonly string[];
  readonly thu?: readonly string[];
  readonly fri?: readonly string[];
  /** 土。 */
  readonly sat?: readonly string[];
  /** 日。 */
  readonly sun?: readonly string[];
}

/** 指定 UTC 時刻における TZ のオフセット（ローカル壁時計 − UTC, ミリ秒）。 */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // 一部環境の 24:00 表記を 0 に正規化
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - utcMs;
}

/**
 * TZ のローカル壁時計（year/month/day/hour/minute）を UTC epoch ms に変換する。
 * DST 境界では二度評価して補正する（date-fns-tz と同方式）。
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

/** ある UTC 時刻の、TZ におけるローカル暦日（年月日）を取得。 */
function localCalendarDate(utcMs: number, tz: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** "HH:MM" を {h,m} に。不正なら null。 */
function parseHm(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m !== 0) return null; // 24:00（=終日終端）以外の 24:xx は不正
  return { h, m };
}

/** 曜日番号(0=日..6=土)に対応する時間帯ペア配列を返す。個別曜日指定があれば優先、無ければ mon_fri にフォールバック。 */
function rangesForWeekday(wh: WorkingHours, weekday: number): readonly string[] {
  switch (weekday) {
    case 0: return wh.sun ?? [];
    case 6: return wh.sat ?? [];
    case 1: return wh.mon ?? wh.mon_fri ?? [];
    case 2: return wh.tue ?? wh.mon_fri ?? [];
    case 3: return wh.wed ?? wh.mon_fri ?? [];
    case 4: return wh.thu ?? wh.mon_fri ?? [];
    case 5: return wh.fri ?? wh.mon_fri ?? [];
    default: return [];
  }
}

/**
 * working_hours を、[fromMs, fromMs + days日) のローカル暦日について UTC ウィンドウへ展開する。
 * 返り値は start 昇順・休業日は除外・overnight（end<=start）はスキップ。
 *
 * @param wh     営業時間設定
 * @param fromMs 起点（UTC epoch ms）。この時刻が属するローカル暦日から数え始める。
 * @param days   展開する暦日数（例: 14）。
 */
export function expandWorkingWindows(wh: WorkingHours, fromMs: number, days: number): Interval[] {
  if (days <= 0) return [];
  const base = localCalendarDate(fromMs, wh.tz);
  // 暦日カウンタは UTC Date を純粋なカレンダーとして用いる（TZ非依存で日加算・曜日取得）。
  const counter = new Date(Date.UTC(base.year, base.month - 1, base.day));
  const out: Interval[] = [];

  for (let i = 0; i < days; i++) {
    const y = counter.getUTCFullYear();
    const mo = counter.getUTCMonth() + 1;
    const d = counter.getUTCDate();
    const weekday = counter.getUTCDay();
    const ranges = rangesForWeekday(wh, weekday);

    for (let r = 0; r + 1 < ranges.length; r += 2) {
      const s = parseHm(ranges[r]!);
      const e = parseHm(ranges[r + 1]!);
      if (!s || !e) continue;
      const start = zonedTimeToUtc(y, mo, d, s.h, s.m, wh.tz);
      const end = zonedTimeToUtc(y, mo, d, e.h, e.m, wh.tz);
      if (start < end) out.push({ start, end });
    }
    counter.setUTCDate(counter.getUTCDate() + 1);
  }

  return out.sort((a, b) => a.start - b.start);
}

export { DAY_MS };
