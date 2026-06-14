import { describe, it, expect } from 'vitest';
import { expandWorkingWindows, zonedTimeToUtc } from '../working-hours.js';

describe('zonedTimeToUtc', () => {
  it('Asia/Tokyo の壁時計を UTC に変換（+09:00）', () => {
    // 2026-06-15 09:00 JST = 2026-06-15 00:00 UTC
    expect(zonedTimeToUtc(2026, 6, 15, 9, 0, 'Asia/Tokyo')).toBe(Date.UTC(2026, 5, 15, 0, 0));
  });

  it('America/New_York の DST 前後でオフセットが変わる', () => {
    // EST(-5): 2026-03-07 09:00 = 14:00 UTC
    expect(zonedTimeToUtc(2026, 3, 7, 9, 0, 'America/New_York')).toBe(Date.UTC(2026, 2, 7, 14, 0));
    // EDT(-4): 2026-03-09 09:00 = 13:00 UTC（固定オフセットなら 14:00 のはず＝DST解決を証明）
    expect(zonedTimeToUtc(2026, 3, 9, 9, 0, 'America/New_York')).toBe(Date.UTC(2026, 2, 9, 13, 0));
  });
});

describe('expandWorkingWindows', () => {
  const wh = { tz: 'Asia/Tokyo', mon_fri: ['09:00', '18:00'], sat: [], sun: [] };

  it('月曜起点7日で平日5枠・週末は休業', () => {
    const from = Date.UTC(2026, 5, 14, 15, 0); // 2026-06-15 00:00 JST（月）
    const windows = expandWorkingWindows(wh, from, 7);
    expect(windows).toHaveLength(5);
    // 初日 = 月 09:00-18:00 JST = 00:00-09:00 UTC
    expect(windows[0]).toEqual({ start: Date.UTC(2026, 5, 15, 0, 0), end: Date.UTC(2026, 5, 15, 9, 0) });
    // 昇順
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.start).toBeGreaterThan(windows[i - 1]!.start);
    }
  });

  it('複数時間帯（午前/午後）にも対応', () => {
    const split = { tz: 'Asia/Tokyo', mon_fri: ['09:00', '12:00', '13:00', '18:00'], sat: [], sun: [] };
    const from = Date.UTC(2026, 5, 14, 15, 0);
    const windows = expandWorkingWindows(split, from, 1);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ start: Date.UTC(2026, 5, 15, 0, 0), end: Date.UTC(2026, 5, 15, 3, 0) });
    expect(windows[1]).toEqual({ start: Date.UTC(2026, 5, 15, 4, 0), end: Date.UTC(2026, 5, 15, 9, 0) });
  });
});
