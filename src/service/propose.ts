/**
 * 候補自動抽出サービス（Spirの「候補を自動抽出」相当）。
 *
 * 入力（期間・選択カレンダー・営業時間・打合せ時間）から、
 *   ① 選択カレンダーのbusyを取得（externalBusyとして注入可能。テスト決定論用）
 *   ② 営業時間ウィンドウを期間内で展開
 *   ③ computeAvailability で候補列挙
 *   ④ maxSlots件で切る
 * を実行する純関数。Google APIへの依存はAPIルートで注入する（テスト容易性）。
 */
import { computeAvailability } from '../domain/availability.js';
import { mergeIntervals, subtract } from '../domain/grid.js';
import { expandWorkingWindows, type WorkingHours } from '../domain/working-hours.js';
import type { Interval, Slot } from '../domain/types.js';

export interface ProposeInput {
  /** 期間開始（UTC epoch ms）。 */
  periodStart: number;
  /** 期間終了（UTC epoch ms）。 */
  periodEnd: number;
  /** 枠の長さ（分）。15/30/45/60/90/120。 */
  durationMinutes: number;
  /** グリッド（分）。既定15。 */
  gridMinutes?: number;
  /** 営業時間。未指定なら平日09:00-18:00／土日休（JST）。 */
  workingHours?: WorkingHours;
  /** バッファ（分）。 */
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  /** 直前ブロック（分）。 */
  minNoticeMin?: number;
  /** 返す最大件数。既定10。 */
  maxSlots?: number;
  /** 注入されたbusy（呼び出し側でgoogleFreeBusy済み）。 */
  busy: Interval[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  tz: 'Asia/Tokyo',
  mon_fri: ['09:00', '18:00'],
  sat: [],
  sun: [],
};

/**
 * 候補を決定論的に算出する。同じ入力 → 同じ出力（テスト・キャッシュ容易性）。
 */
export function proposeSlots(input: ProposeInput): Slot[] {
  const wh = input.workingHours ?? DEFAULT_WORKING_HOURS;
  const days = Math.max(1, Math.ceil((input.periodEnd - input.periodStart) / DAY_MS) + 1);
  const allWindows = expandWorkingWindows(wh, input.periodStart, days);
  // 期間外は除外
  const workingWindows: Interval[] = allWindows
    .map((w) => ({
      start: Math.max(w.start, input.periodStart),
      end: Math.min(w.end, input.periodEnd),
    }))
    .filter((w) => w.start < w.end);

  const slots = computeAvailability({
    workingWindows,
    busy: input.busy,
    durationMin: input.durationMinutes,
    minNoticeMin: input.minNoticeMin ?? 0,
    bufferBeforeMin: input.bufferBeforeMin ?? 0,
    bufferAfterMin: input.bufferAfterMin ?? 0,
    now: input.periodStart,
    // 既定gridを打合せ時間と同じに：30分予定なら30分step（14:30,15:00,…）で重複候補ゼロ。
    // 明示で gridMinutes を渡せば旧来の15分刻み等にも切替可能。
    gridMs: (input.gridMinutes ?? input.durationMinutes) * 60 * 1000,
  });
  const max = Math.max(1, input.maxSlots ?? 10);
  return slots.slice(0, max);
}

/**
 * busyByCalendar（Google freebusy.query の"隙間なく連続する予定は1本にまとめる"挙動をそのまま
 * 反映した区間）に、events.list 由来の実イベントのタイトルを重ねてDTO化する。
 *
 * Google の freebusy.query は隙間のない連続する複数の予定を1本のbusy区間にまとめて返す。
 * 単純に「区間に最初に重なったイベント1件」のタイトルを区間全体に当てはめると、実際には
 * 別々の複数の会議（例：ステップアップMTG→交通誘導MTG→総務MTG）が「ステップアップMTGが
 * 3時間続いている」ように誤表示されてしまう（社長指摘：読み込みミスが致命的）。
 * ここでは区間ごとに重なる実イベントを"全部"拾い、それぞれ本来の時刻・タイトルのまま個別の
 * ブロックとして出す。タイトル付きイベントで覆われていない残り（freeBusyReader専用カレンダー等、
 * タイトルが取得できないbusy）だけをタイトル無しブロックとして残す。
 */
export function splitBusyIntervalsByTitle(
  busyByCalendar: Record<string, Interval[]>,
  titlesByCalendar: Record<string, { start: number; end: number; title: string }[]>,
): Record<string, { start: string; end: string; title?: string }[]> {
  const out: Record<string, { start: string; end: string; title?: string }[]> = {};
  for (const calId of Object.keys(busyByCalendar)) {
    const intervals = busyByCalendar[calId] ?? [];
    const titles = titlesByCalendar[calId] ?? [];
    const dtoList: { start: string; end: string; title?: string }[] = [];
    for (const iv of intervals) {
      const overlapping = titles.filter((t) => t.start < iv.end && t.end > iv.start);
      if (overlapping.length === 0) {
        dtoList.push({ start: new Date(iv.start).toISOString(), end: new Date(iv.end).toISOString() });
        continue;
      }
      const covered: Interval[] = [];
      for (const t of overlapping) {
        const s = Math.max(t.start, iv.start);
        const e = Math.min(t.end, iv.end);
        covered.push({ start: s, end: e });
        dtoList.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), title: t.title });
      }
      for (const gap of subtract([iv], mergeIntervals(covered))) {
        dtoList.push({ start: new Date(gap.start).toISOString(), end: new Date(gap.end).toISOString() });
      }
    }
    out[calId] = dtoList;
  }
  return out;
}
