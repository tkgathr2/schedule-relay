/**
 * /propose のカレンダー上で候補ブロックをドラッグ移動／下端リサイズするときの
 * 純粋な計算ロジック。React 非依存・時刻 ms 単位。Vitest でユニットテスト可能。
 *
 * - 15分グリッドへのスナップ
 * - 営業時間（dayStart/dayEnd）内へのクランプ
 * - busy / 他候補との衝突判定
 */

export const MIN_PER_MS = 1 / 60000;

/** px → 分（slotPx = 1時間=slotPx px） */
export function pxToMinutes(px: number, slotPx: number): number {
  return (px / slotPx) * 60;
}

/** 分 → px */
export function minutesToPx(min: number, slotPx: number): number {
  return (min / 60) * slotPx;
}

/** 分を grid 分単位（例: 15）にスナップ（四捨五入） */
export function snapMinutes(min: number, grid: number): number {
  if (grid <= 0) return min;
  return Math.round(min / grid) * grid;
}

/** ms を grid 分にスナップ */
export function snapMs(ms: number, gridMin: number): number {
  const gridMs = gridMin * 60_000;
  if (gridMs <= 0) return ms;
  return Math.round(ms / gridMs) * gridMs;
}

export type Range = { start: number; end: number };

/** 2 区間が重なるか（端点接触は重ならない扱い：a.end === b.start は OK） */
export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/** target が others のどれかと重なれば true */
export function hasConflict(target: Range, others: Range[]): boolean {
  for (const o of others) {
    if (overlaps(target, o)) return true;
  }
  return false;
}

/**
 * 移動（drag）：候補を delta ms 動かしたうえで、duration を保ったまま
 * [dayStart, dayEnd] にクランプ。
 */
export function moveRange(
  orig: Range,
  deltaMs: number,
  dayStart: number,
  dayEnd: number,
  gridMin = 15,
): Range {
  const duration = orig.end - orig.start;
  let newStart = snapMs(orig.start + deltaMs, gridMin);
  if (newStart < dayStart) newStart = dayStart;
  if (newStart + duration > dayEnd) newStart = dayEnd - duration;
  return { start: newStart, end: newStart + duration };
}

/**
 * 下端リサイズ：end のみ deltaMs 動かす。
 * 最小は duration（=minDurationMs）、最大は dayEnd または直後 busy の手前。
 */
export function resizeEnd(
  orig: Range,
  deltaMs: number,
  dayEnd: number,
  minDurationMs: number,
  gridMin = 15,
  maxEnd?: number,
): Range {
  let newEnd = snapMs(orig.end + deltaMs, gridMin);
  const upper = maxEnd !== undefined ? Math.min(dayEnd, maxEnd) : dayEnd;
  if (newEnd > upper) newEnd = upper;
  if (newEnd - orig.start < minDurationMs) newEnd = orig.start + minDurationMs;
  return { start: orig.start, end: newEnd };
}

/**
 * busy 配列のうち target.start 以後で最も近い start を返す。なければ undefined。
 * リサイズ時に「下にある busy の直前まで」の上限を決めるのに使う。
 */
export function nextBusyStart(target: Range, busies: Range[]): number | undefined {
  let best: number | undefined;
  for (const b of busies) {
    if (b.start >= target.end) {
      if (best === undefined || b.start < best) best = b.start;
    }
  }
  return best;
}

/**
 * 候補slot群を「連続/重なる」グループにまとめる。
 * - 入力 slots は {idx, start, end}（同じ日のもの想定）
 * - start 昇順にソートしてから、隣接 last.end >= s.start で同グループに統合
 * - グループ end = グループ内 slot の end の最大値
 * - tailIdx = グループ内で「end が最大」の slot の idx（リサイズで延長する対象）
 *
 * これにより、Spirと同じく連続候補が1つの大きな青点線ブロックとして描画でき、
 * グループ単位で move／resize できる。
 */
export type SlotWithIdx = { idx: number; start: number; end: number };
export type SlotGroup = {
  start: number;
  end: number;
  idxs: number[];
  tailIdx: number;
};
export function groupSlots(slots: SlotWithIdx[]): SlotGroup[] {
  const sorted = [...slots].sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: SlotGroup[] = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.end >= s.start) {
      // 統合：end は最大値、tailIdx は end が最大の slot
      if (s.end > last.end) {
        last.end = s.end;
        last.tailIdx = s.idx;
      }
      last.idxs.push(s.idx);
    } else {
      groups.push({ start: s.start, end: s.end, idxs: [s.idx], tailIdx: s.idx });
    }
  }
  return groups;
}
