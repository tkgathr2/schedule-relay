/**
 * 空き算出エンジン（仕様 §6/§7/§12）。
 * 営業時間ウィンドウ・busy・バッファ・直前予約ブロック・15分グリッドを適用し、
 * 確定候補となる枠を決定論的に列挙する。
 *
 * 注意：営業時間(working_hours)の「曜日×TZ→UTCウィンドウ」への展開は、DST境界を
 * 正しく解決するため presentation/設定層で行い、ここには解決済みの UTC ウィンドウ
 * (workingWindows) を渡す（仕様 §19：固定オフセット禁止＝IANA TZで解決）。
 */
import { GRID_MS, MINUTE_MS, type Interval, type Slot } from './types.js';
import { enumerateSlots, mergeIntervals, subtract } from './grid.js';

export interface AvailabilityInput {
  /** 解決済みの営業時間ウィンドウ（UTC）。この範囲の中だけ提示する。 */
  readonly workingWindows: readonly Interval[];
  /** カレンダー横断の busy 区間（UTC）。 */
  readonly busy: readonly Interval[];
  /** 枠の長さ（分）。 */
  readonly durationMin: number;
  /** 直前予約ブロック：now からこの分数より後しか提示しない。 */
  readonly minNoticeMin?: number;
  /** バッファ（分）：予定の前後に余白を確保する。 */
  readonly bufferBeforeMin?: number;
  readonly bufferAfterMin?: number;
  /** 現在時刻（UTC epoch ms）。テスト容易性のため引数で受ける（決定論）。 */
  readonly now: number;
  /** グリッド（ミリ秒）。既定15分。 */
  readonly gridMs?: number;
}

/** busy 区間をバッファ分だけ前後に膨らませる。 */
export function inflate(busy: readonly Interval[], beforeMs: number, afterMs: number): Interval[] {
  return busy.map((b) => ({ start: b.start - beforeMs, end: b.end + afterMs }));
}

/**
 * 空き枠を算出する。
 * 手順：①minNotice/durationで下限カット ②buffer分busyを膨張 ③営業時間からbusyを差引
 *       ④15分グリッドでduration枠を列挙。
 * 返り値は start 昇順（タイブレークの前段）。
 */
export function computeAvailability(input: AvailabilityInput): Slot[] {
  const grid = input.gridMs ?? GRID_MS;
  const durationMs = input.durationMin * MINUTE_MS;
  const minNoticeMs = (input.minNoticeMin ?? 0) * MINUTE_MS;
  const earliest = input.now + minNoticeMs;

  // ① 営業時間ウィンドウを「earliest 以降」に制限
  const windows: Interval[] = mergeIntervals(input.workingWindows)
    .map((w) => ({ start: Math.max(w.start, earliest), end: w.end }))
    .filter((w) => w.start < w.end);

  // ② busy をバッファ膨張
  const inflated = inflate(
    input.busy,
    (input.bufferBeforeMin ?? 0) * MINUTE_MS,
    (input.bufferAfterMin ?? 0) * MINUTE_MS,
  );

  // ③ 空き区間 = 営業時間 − busy(膨張済み)
  const free = subtract(windows, inflated);

  // ④ duration 枠を15分刻みで列挙
  return enumerateSlots(free, durationMs, grid).sort((a, b) => a.start - b.start);
}
