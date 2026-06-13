import { describe, it, expect } from 'vitest';
import {
  alignUp,
  alignDown,
  isAligned,
  overlaps,
  mergeIntervals,
  subtract,
  enumerateSlots,
} from '../grid.js';
import { GRID_MS } from '../types.js';

const T0 = Date.UTC(2026, 5, 15, 0, 0, 0); // 2026-06-15T00:00:00Z
const m = (min: number) => T0 + min * 60_000;

describe('grid alignment', () => {
  it('aligns up/down to 15min', () => {
    expect(alignDown(m(7))).toBe(m(0));
    expect(alignUp(m(7))).toBe(m(15));
    expect(alignUp(m(15))).toBe(m(15)); // 境界はそのまま
    expect(isAligned(m(15))).toBe(true);
    expect(isAligned(m(7))).toBe(false);
  });
});

describe('overlaps (half-open)', () => {
  it('端点共有は重複としない', () => {
    expect(overlaps({ start: m(0), end: m(30) }, { start: m(30), end: m(60) })).toBe(false);
  });
  it('実際の重なりは検出する', () => {
    expect(overlaps({ start: m(0), end: m(30) }, { start: m(15), end: m(45) })).toBe(true);
  });
});

describe('mergeIntervals', () => {
  it('入力順に依存せず統合する（決定論）', () => {
    const a = mergeIntervals([
      { start: m(30), end: m(60) },
      { start: m(0), end: m(30) }, // 隣接 → 統合
    ]);
    expect(a).toEqual([{ start: m(0), end: m(60) }]);
  });
});

describe('subtract', () => {
  it('busy を差し引いて空きを返す', () => {
    const free = subtract([{ start: m(0), end: m(120) }], [{ start: m(30), end: m(60) }]);
    expect(free).toEqual([
      { start: m(0), end: m(30) },
      { start: m(60), end: m(120) },
    ]);
  });
});

describe('enumerateSlots', () => {
  it('30分枠を15分刻みで列挙、空きに収まるもののみ', () => {
    const slots = enumerateSlots([{ start: m(0), end: m(60) }], 30 * 60_000, GRID_MS);
    expect(slots).toEqual([
      { start: m(0), end: m(30) },
      { start: m(15), end: m(45) },
      { start: m(30), end: m(60) },
    ]);
  });
});
