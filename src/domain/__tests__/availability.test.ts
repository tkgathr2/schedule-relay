import { describe, it, expect } from 'vitest';
import { computeAvailability } from '../availability.js';

const D = (h: number, min = 0) => Date.UTC(2026, 5, 15, h, min, 0); // 2026-06-15

describe('computeAvailability', () => {
  it('営業時間・直前ブロック・バッファを尊重した空き算出（仕様 §22 予約ページ運用）', () => {
    // 営業時間 09:00-12:00、既存予定 10:00-10:30、now=08:00、min_notice=120分、buffer.after=10分、30分枠
    const slots = computeAvailability({
      workingWindows: [{ start: D(9), end: D(12) }],
      busy: [{ start: D(10), end: D(10, 30) }],
      durationMin: 30,
      minNoticeMin: 120, // 08:00 + 120 = 10:00 以降のみ
      bufferAfterMin: 10, // 予定後10分は空けない → busy を 10:40 まで膨張
      now: D(8),
      gridMs: 15 * 60_000,
    });
    // earliest=10:00。busy(膨張)=10:00-10:40。空き=10:40-12:00。30分枠を15分刻みで：
    // 10:45-11:15, 11:00-11:30, 11:15-11:45, 11:30-12:00（10:40は非グリッド→切上げ10:45）
    expect(slots[0]).toEqual({ start: D(10, 45), end: D(11, 15) });
    expect(slots[slots.length - 1]).toEqual({ start: D(11, 30), end: D(12) });
    // すべて 10:00 以降、かつ duration=30分
    expect(slots.every((s) => s.start >= D(10))).toBe(true);
    expect(slots.every((s) => s.end - s.start === 30 * 60_000)).toBe(true);
  });

  it('同じ入力なら常に同じ結果（決定論）', () => {
    const input = {
      workingWindows: [{ start: D(9), end: D(18) }],
      busy: [{ start: D(13), end: D(14) }],
      durationMin: 60,
      now: D(0),
    };
    expect(computeAvailability(input)).toEqual(computeAvailability(input));
  });

  it('busy で全部埋まると空きゼロ', () => {
    const slots = computeAvailability({
      workingWindows: [{ start: D(9), end: D(10) }],
      busy: [{ start: D(9), end: D(10) }],
      durationMin: 30,
      now: D(0),
    });
    expect(slots).toEqual([]);
  });
});
