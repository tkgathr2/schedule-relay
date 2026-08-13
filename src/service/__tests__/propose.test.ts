/**
 * proposeSlots の決定論検証（候補自動抽出）。
 * 同じ入力 → 同じ出力／busyが正しく差し引かれる／maxSlotsで切れる。
 */
import { describe, it, expect } from 'vitest';
import { proposeSlots, splitBusyIntervalsByTitle, DEFAULT_WORKING_HOURS } from '../propose.js';

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

  // 回帰防止（2026-08-10）：/api/availability/propose の route.ts が gridMinutes 未指定時に
  // 15分固定を渡していたため、60分の会議候補が15分刻み（60,75,90,...分ずらし）で大量発生し、
  // maxSlotsに数日分だけで達してしまい、後半の日程（土日を含む）が一切候補に出ない不具合があった。
  // gridMinutes を本当に未指定（undefined）で渡せば durationMinutes と同じ刻みになり、
  // 期間全体にまんべんなく候補が分散することを検証する。
  it('gridMinutes未指定なら duration と同じ刻みになり、期間全体に候補が分散する（土日含む）', () => {
    const weekStart = PERIOD_START; // 月曜0時JST
    const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000; // 8日分（土日を含む）
    const wh = {
      tz: 'Asia/Tokyo',
      mon: ['09:00', '18:00'],
      tue: ['09:00', '18:00'],
      wed: ['09:00', '18:00'],
      thu: ['09:00', '18:00'],
      fri: ['09:00', '18:00'],
      sat: ['09:00', '18:00'],
      sun: ['09:00', '18:00'],
    };
    const slots = proposeSlots({
      periodStart: weekStart,
      periodEnd: weekEnd,
      durationMinutes: 60,
      workingHours: wh,
      busy: [],
      maxSlots: 50, // UIの既定値と同じ規模
      // gridMinutes は意図的に指定しない
    });
    const days = new Set(
      slots.map((s) => new Date(s.start + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)),
    );
    // 平日09-18時・60分刻みなら1日9枠。50件では6日目まで届くはず（土日を含む）。
    expect(days.size).toBeGreaterThanOrEqual(6);
    // 60分刻みなので、隣り合う候補の開始時刻差は60分単位（15分刻みの重複が発生していない）
    for (const s of slots) {
      expect(new Date(s.start).getUTCMinutes() % 60 === new Date(weekStart).getUTCMinutes() % 60).toBe(true);
    }
  });

  it('gridMinutesを明示指定すればその刻みで候補が出る（従来動作を維持）', () => {
    const slots = proposeSlots({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      durationMinutes: 60,
      gridMinutes: 15,
      workingHours: DEFAULT_WORKING_HOURS,
      busy: [],
      maxSlots: 10,
    });
    expect(slots.length).toBe(10);
    // 15分刻みなので連続する候補の開始差が15分のケースが存在する
    const diffs = slots.slice(1).map((s, i) => s.start - slots[i]!.start);
    expect(diffs.some((d) => d === 15 * 60 * 1000)).toBe(true);
  });
});

describe('splitBusyIntervalsByTitle（社長指摘・2026-08-13：連続する複数会議が1件の会議として誤表示される問題の回帰防止）', () => {
  const MIN = 60 * 1000;
  const T0 = PERIOD_START; // 09:00相当の基準時刻として使う

  it('freebusyが1本にまとめた連続3件の会議を、それぞれ元の時刻・タイトルのまま別ブロックとして出す', () => {
    // 実際の社長報告を再現：09:30-10:30 ステップアップMTG／10:30-11:30 交通誘導MTG／11:30-12:30 総務MTG
    // が freebusy.query では隙間なしのため 09:30-12:30 の1本にまとめられて返ってくる。
    const mergedBusy = { start: T0, end: T0 + 180 * MIN };
    const titles = [
      { start: T0, end: T0 + 60 * MIN, title: '【週次】ステップアップMTG' },
      { start: T0 + 60 * MIN, end: T0 + 120 * MIN, title: '【週次】交通誘導MTG' },
      { start: T0 + 120 * MIN, end: T0 + 180 * MIN, title: '総務MTG' },
    ];

    const result = splitBusyIntervalsByTitle({ cal1: [mergedBusy] }, { cal1: titles });

    expect(result.cal1).toHaveLength(3);
    expect(result.cal1).toContainEqual({
      start: new Date(T0).toISOString(),
      end: new Date(T0 + 60 * MIN).toISOString(),
      title: '【週次】ステップアップMTG',
    });
    expect(result.cal1).toContainEqual({
      start: new Date(T0 + 60 * MIN).toISOString(),
      end: new Date(T0 + 120 * MIN).toISOString(),
      title: '【週次】交通誘導MTG',
    });
    expect(result.cal1).toContainEqual({
      start: new Date(T0 + 120 * MIN).toISOString(),
      end: new Date(T0 + 180 * MIN).toISOString(),
      title: '総務MTG',
    });
    // 「ステップアップMTGが3時間続いている」という誤ったブロックが出ていないこと
    expect(result.cal1.some((b) => b.title === '【週次】ステップアップMTG' && b.end === new Date(T0 + 180 * MIN).toISOString())).toBe(false);
  });

  it('タイトルが取得できない部分（freeBusyReader専用カレンダー等）はタイトル無しブロックとして残す', () => {
    const busy = { start: T0, end: T0 + 120 * MIN };
    // 前半60分だけ実イベントのタイトルが取れている想定
    const titles = [{ start: T0, end: T0 + 60 * MIN, title: '会議A' }];

    const result = splitBusyIntervalsByTitle({ cal1: [busy] }, { cal1: titles });

    expect(result.cal1).toHaveLength(2);
    expect(result.cal1).toContainEqual({
      start: new Date(T0).toISOString(),
      end: new Date(T0 + 60 * MIN).toISOString(),
      title: '会議A',
    });
    const untitled = result.cal1.find((b) => !b.title);
    expect(untitled).toEqual({
      start: new Date(T0 + 60 * MIN).toISOString(),
      end: new Date(T0 + 120 * MIN).toISOString(),
    });
  });

  it('一致するタイトルが1件もなければ従来通りタイトル無しの1ブロック', () => {
    const busy = { start: T0, end: T0 + 60 * MIN };
    const result = splitBusyIntervalsByTitle({ cal1: [busy] }, { cal1: [] });
    expect(result.cal1).toEqual([{ start: new Date(T0).toISOString(), end: new Date(T0 + 60 * MIN).toISOString() }]);
  });
});
