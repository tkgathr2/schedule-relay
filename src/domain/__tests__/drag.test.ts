import { describe, it, expect } from 'vitest';
import {
  pxToMinutes,
  minutesToPx,
  snapMinutes,
  snapMs,
  overlaps,
  hasConflict,
  moveRange,
  resizeEnd,
  nextBusyStart,
  groupSlots,
} from '../drag';

const MIN = 60_000;

// 2026-06-15 (mon) JST 09:00 = base; 全テストでこのbaseを起点に。
const base = Date.parse('2026-06-15T09:00:00+09:00');
const dayStart = Date.parse('2026-06-15T09:00:00+09:00');
const dayEnd = Date.parse('2026-06-15T18:00:00+09:00');

describe('pxToMinutes / minutesToPx', () => {
  it('60px = 60min when slotPx=60', () => {
    expect(pxToMinutes(60, 60)).toBe(60);
    expect(minutesToPx(60, 60)).toBe(60);
  });
  it('15px = 15min when slotPx=60', () => {
    expect(pxToMinutes(15, 60)).toBe(15);
    expect(minutesToPx(15, 60)).toBe(15);
  });
  it('round trip', () => {
    expect(minutesToPx(pxToMinutes(33, 60), 60)).toBeCloseTo(33);
  });
});

describe('snapMinutes / snapMs', () => {
  it('snaps to nearest 15', () => {
    expect(snapMinutes(7, 15)).toBe(0);
    expect(snapMinutes(8, 15)).toBe(15);
    expect(snapMinutes(22, 15)).toBe(15);
    expect(snapMinutes(23, 15)).toBe(30);
  });
  it('snapMs snaps to 15min boundary', () => {
    const t = base + 7 * MIN;
    expect(snapMs(t, 15)).toBe(base);
    expect(snapMs(base + 8 * MIN, 15)).toBe(base + 15 * MIN);
  });
  it('grid 0 is identity', () => {
    expect(snapMinutes(11, 0)).toBe(11);
  });
});

describe('overlaps', () => {
  it('touching edges do not overlap', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });
  it('clear overlap', () => {
    expect(overlaps({ start: 0, end: 15 }, { start: 10, end: 20 })).toBe(true);
  });
  it('contained', () => {
    expect(overlaps({ start: 5, end: 8 }, { start: 0, end: 20 })).toBe(true);
  });
  it('disjoint', () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 10, end: 20 })).toBe(false);
  });
});

describe('hasConflict', () => {
  it('returns true on any conflict', () => {
    const target = { start: base, end: base + 30 * MIN };
    const others = [
      { start: base + 60 * MIN, end: base + 90 * MIN },
      { start: base + 20 * MIN, end: base + 50 * MIN }, // collides
    ];
    expect(hasConflict(target, others)).toBe(true);
  });
  it('returns false when none', () => {
    const target = { start: base, end: base + 30 * MIN };
    const others = [{ start: base + 60 * MIN, end: base + 90 * MIN }];
    expect(hasConflict(target, others)).toBe(false);
  });
});

describe('moveRange', () => {
  it('snaps and shifts by delta', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const moved = moveRange(orig, 15 * MIN, dayStart, dayEnd, 15);
    expect(moved.start).toBe(base + 15 * MIN);
    expect(moved.end).toBe(base + 45 * MIN);
  });
  it('snaps non-aligned delta to grid', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const moved = moveRange(orig, 7 * MIN, dayStart, dayEnd, 15);
    expect(moved.start).toBe(base);
  });
  it('clamps to dayStart on negative drag', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const moved = moveRange(orig, -60 * MIN, dayStart, dayEnd, 15);
    expect(moved.start).toBe(dayStart);
    expect(moved.end - moved.start).toBe(30 * MIN);
  });
  it('clamps to dayEnd preserving duration', () => {
    const orig = { start: dayEnd - 30 * MIN, end: dayEnd };
    const moved = moveRange(orig, 60 * MIN, dayStart, dayEnd, 15);
    expect(moved.end).toBe(dayEnd);
    expect(moved.end - moved.start).toBe(30 * MIN);
  });
});

describe('resizeEnd', () => {
  it('extends end by delta', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const out = resizeEnd(orig, 30 * MIN, dayEnd, 30 * MIN, 15);
    expect(out.start).toBe(base);
    expect(out.end).toBe(base + 60 * MIN);
  });
  it('cannot shrink below minDuration', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const out = resizeEnd(orig, -60 * MIN, dayEnd, 30 * MIN, 15);
    expect(out.end - out.start).toBe(30 * MIN);
  });
  it('clamps to dayEnd', () => {
    const orig = { start: dayEnd - 30 * MIN, end: dayEnd };
    const out = resizeEnd(orig, 60 * MIN, dayEnd, 30 * MIN, 15);
    expect(out.end).toBe(dayEnd);
  });
  it('clamps to maxEnd (e.g. before next busy)', () => {
    const orig = { start: base, end: base + 30 * MIN };
    const maxEnd = base + 45 * MIN;
    const out = resizeEnd(orig, 60 * MIN, dayEnd, 30 * MIN, 15, maxEnd);
    expect(out.end).toBe(maxEnd);
  });
});

describe('nextBusyStart', () => {
  it('returns the earliest busy.start after target.end', () => {
    const target = { start: base, end: base + 30 * MIN };
    const busies = [
      { start: base + 120 * MIN, end: base + 150 * MIN },
      { start: base + 60 * MIN, end: base + 90 * MIN },
    ];
    expect(nextBusyStart(target, busies)).toBe(base + 60 * MIN);
  });
  it('returns undefined when none after', () => {
    const target = { start: base + 200 * MIN, end: base + 230 * MIN };
    const busies = [{ start: base, end: base + 30 * MIN }];
    expect(nextBusyStart(target, busies)).toBeUndefined();
  });
});

describe('groupSlots', () => {
  it('merges contiguous/overlapping slots into one group', () => {
    // 10:15-10:45 と 10:30-11:00（重なる）→ 1グループ 10:15-11:00
    const slots = [
      { idx: 0, start: base + 75 * MIN, end: base + 105 * MIN }, // 10:15-10:45
      { idx: 1, start: base + 90 * MIN, end: base + 120 * MIN }, // 10:30-11:00
    ];
    const groups = groupSlots(slots);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.start).toBe(base + 75 * MIN);
    expect(groups[0]!.end).toBe(base + 120 * MIN);
    expect(groups[0]!.idxs.sort()).toEqual([0, 1]);
    expect(groups[0]!.tailIdx).toBe(1); // end が最大の slot
  });
  it('keeps disjoint slots in separate groups', () => {
    const slots = [
      { idx: 0, start: base, end: base + 30 * MIN }, // 09:00-09:30
      { idx: 1, start: base + 60 * MIN, end: base + 90 * MIN }, // 10:00-10:30
    ];
    const groups = groupSlots(slots);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.idxs).toEqual([0]);
    expect(groups[1]!.idxs).toEqual([1]);
  });
  it('merges 3 chained slots', () => {
    const slots = [
      { idx: 0, start: base, end: base + 30 * MIN },
      { idx: 1, start: base + 15 * MIN, end: base + 60 * MIN },
      { idx: 2, start: base + 45 * MIN, end: base + 90 * MIN },
    ];
    const groups = groupSlots(slots);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.start).toBe(base);
    expect(groups[0]!.end).toBe(base + 90 * MIN);
    expect(groups[0]!.tailIdx).toBe(2);
  });
  it('input order does not affect grouping (sorts by start)', () => {
    const slots = [
      { idx: 1, start: base + 90 * MIN, end: base + 120 * MIN },
      { idx: 0, start: base + 75 * MIN, end: base + 105 * MIN },
    ];
    const groups = groupSlots(slots);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.idxs.sort()).toEqual([0, 1]);
  });
  it('end===start is considered contiguous (end >= next.start)', () => {
    // 09:00-09:30 と 09:30-10:00 → 1グループ
    const slots = [
      { idx: 0, start: base, end: base + 30 * MIN },
      { idx: 1, start: base + 30 * MIN, end: base + 60 * MIN },
    ];
    const groups = groupSlots(slots);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.end).toBe(base + 60 * MIN);
    expect(groups[0]!.tailIdx).toBe(1);
  });
  it('returns empty array for empty input', () => {
    expect(groupSlots([])).toEqual([]);
  });
});
