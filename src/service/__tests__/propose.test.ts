/**
 * proposeSlots の決定論検証（候補自動抽出）。
 * 同じ入力 → 同じ出力／busyが正しく差し引かれる／maxSlotsで切れる。
 */
import { describe, it, expect } from 'vitest';
import { proposeSlots, DEFAULT_WORKING_HOURS } from '../propose.js';

// 2026-06-15(月) 00:00 JST = 2026-06-14T15:00Z
const PERIOD_START = Date.UTC(2026, 5, 14, 15, 0); // JST月曜0時
const PERIOD_END = PERIOD_START + 5 * 24 * 60 * 60 * 1000; // 5日後（金曜末）

describe('proposeSlots', () => {
  it('同じ入力 → 同じ出力（決定論）', () => {
    const input = {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      durationMinutes: 30,
      busy: [],
      maxSlots: 5,
    };
    const a = proposeSlots(input);
    const b = proposeSlots(input);
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
  });

  it('busy区間がある時間帯の枠を除外する', () => {
    // 月曜10:00-11:00 JST = UTC 01:00-02:00
    const busyStart = Date.UTC(2026, 5, 15, 1, 0);
    const busyEnd = Date.UTC(2026, 5, 15, 2, 0);
    const slots = proposeSlots({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      durationMinutes: 30,
      busy: [{ start: busyStart, end: busyEnd }],
      maxSlots: 100,
    });
    // busy区間と重なるスロットが無いことを確認
    const overlap = slots.some((s) => s.start < busyEnd && s.end > busyStart);
    expect(overlap).toBe(false);
  });

  it('maxSlotsで結果を制限する', () => {
    const slots = proposeSlots({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      durationMinutes: 30,
      busy: [],
      maxSlots: 3,
    });
    expect(slots.length).toBe(3);
  });

  it('デフォルト営業時間は平日09:00-18:00（JST）', () => {
    const slots = proposeSlots({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      durationMinutes: 60,
      workingHours: DEFAULT_WORKING_HOURS,
      busy: [],
      maxSlots: 50,
    });
    // 全スロットが UTC 00:00-09:00（JST 09:00-18:00）の範囲内
    for (const s of slots) {
      const hourUtc = new Date(s.start).getUTCHours();
      // JST 09:00 = UTC 00:00, JST 17:00枠終了18:00 = UTC 09:00（end）
      expect(hourUtc >= 0 && hourUtc < 9).toBe(true);
    }
  });

  it('期間が短いと候補ゼロでも例外を吐かない', () => {
    const slots = proposeSlots({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_START + 60 * 1000, // 1分しかない
      durationMinutes: 30,
      busy: [],
      maxSlots: 10,
    });
    expect(slots).toEqual([]);
  });
});
