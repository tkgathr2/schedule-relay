/**
 * 15分グリッドと半開区間の演算（仕様 §7-2/§7-3）。
 * すべて純関数・UTC epoch ミリ秒で決定論的。
 */
import { GRID_MS, type EpochMs, type Interval } from './types.js';

/** ms をグリッド境界へ切り下げ。 */
export function alignDown(ms: EpochMs, grid: number = GRID_MS): EpochMs {
  return Math.floor(ms / grid) * grid;
}

/** ms をグリッド境界へ切り上げ。 */
export function alignUp(ms: EpochMs, grid: number = GRID_MS): EpochMs {
  return Math.ceil(ms / grid) * grid;
}

/** グリッド境界に乗っているか。 */
export function isAligned(ms: EpochMs, grid: number = GRID_MS): boolean {
  return ms % grid === 0;
}

/**
 * 2区間が半開区間 [start,end) として重なるか。
 * 端点共有（a.end === b.start）は重複としない（仕様 §7-3）。
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 区間長（ミリ秒）。 */
export function durationOf(i: Interval): number {
  return i.end - i.start;
}

/** 有効な区間か（start < end）。 */
export function isValidInterval(i: Interval): boolean {
  return i.start < i.end;
}

/**
 * 複数区間を昇順整列し、重なり・隣接を統合（マージ）する。
 * busy 集合の正規化に使う。
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter(isValidInterval)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      // 重なり or 隣接 → 統合（end は大きい方）
      if (cur.end > last.end) out[out.length - 1] = { start: last.start, end: cur.end };
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/**
 * base 区間群から busy 区間群を差し引いた「空き」区間を返す。
 * 入力順に依存しない決定論的結果（内部でマージ・整列）。
 */
export function subtract(base: readonly Interval[], busy: readonly Interval[]): Interval[] {
  const mergedBusy = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const b of mergeIntervals(base)) {
    let cursor = b.start;
    for (const x of mergedBusy) {
      if (x.end <= cursor) continue; // busy が左側
      if (x.start >= b.end) break; // busy が右側（以降は無関係）
      if (x.start > cursor) out.push({ start: cursor, end: Math.min(x.start, b.end) });
      cursor = Math.max(cursor, x.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) out.push({ start: cursor, end: b.end });
  }
  return out.filter(isValidInterval);
}

/**
 * 空き区間から、長さ durationMs の候補枠を step ごとに列挙する。
 * 開始は grid に整列。枠全体が空き区間に収まるもののみ返す。
 */
export function enumerateSlots(
  free: readonly Interval[],
  durationMs: number,
  step: number = GRID_MS,
): Interval[] {
  const out: Interval[] = [];
  for (const f of mergeIntervals(free)) {
    let start = alignUp(f.start, step);
    while (start + durationMs <= f.end) {
      out.push({ start, end: start + durationMs });
      start += step;
    }
  }
  return out;
}
