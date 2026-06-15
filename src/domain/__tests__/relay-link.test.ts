/**
 * リレー型 T6 リンクの「順序付き連続候補列挙」のテスト。
 */
import { describe, it, expect } from 'vitest';
import { enumerateRelayCandidates } from '../relay-link.js';
import type { Interval } from '../types.js';

// 2026/06/22(月) 09:00 JST = 2026-06-22T00:00:00Z
const JST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** JST の日時を UTC ms に。 */
function jst(yyyymmdd: string, hhmm: string): number {
  const [y, m, d] = yyyymmdd.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(y, m - 1, d, h, mi) - JST_OFFSET;
}

/** 1日分の営業時間 [09:00, 18:00) JST。 */
function dayWindow(yyyymmdd: string): Interval {
  return { start: jst(yyyymmdd, '09:00'), end: jst(yyyymmdd, '18:00') };
}

describe('enumerateRelayCandidates', () => {
  it('全員空き＝先頭から並ぶ候補を返す（A→B→C）', () => {
    const windows = [dayWindow('2026-06-22'), dayWindow('2026-06-23'), dayWindow('2026-06-24')];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
        { order: 3, label: 'C', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 5,
    });
    expect(out.length).toBe(5);
    // 候補は3ステージずつ
    expect(out[0]!.stages).toHaveLength(3);
    // ステージ昇順
    expect(out[0]!.stages[0]!.order).toBe(1);
    expect(out[0]!.stages[1]!.order).toBe(2);
    expect(out[0]!.stages[2]!.order).toBe(3);
  });

  it('ステージi+1 は stage[i].end + buffer 以降のみ', () => {
    const windows = [dayWindow('2026-06-22')];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 30,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 10,
    });
    for (const c of out) {
      const a = c.stages[0]!;
      const b = c.stages[1]!;
      // b.start >= a.end + 30min
      expect(b.start).toBeGreaterThanOrEqual(a.end + 30 * 60 * 1000);
    }
  });

  it('maxGapDays を超える候補は出さない', () => {
    // 60日分の営業時間
    const windows: Interval[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(jst('2026-06-22', '00:00') + i * DAY);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      windows.push(dayWindow(`${yyyy}-${mm}-${dd}`));
    }
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
        { order: 3, label: 'C', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 7,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 50,
    });
    for (const c of out) {
      const first = c.stages[0]!.start;
      const last = c.stages[c.stages.length - 1]!.start;
      expect(last - first).toBeLessThanOrEqual(7 * DAY);
    }
  });

  it('ステージのうち1つでも空きゼロなら候補なし', () => {
    const windows = [dayWindow('2026-06-22')];
    // B のbusyで全営業時間を埋める
    const fullBusy: Interval[] = [
      { start: jst('2026-06-22', '00:00'), end: jst('2026-06-22', '23:59') },
    ];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: fullBusy },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
    });
    expect(out).toEqual([]);
  });

  it('busy を尊重する（A:10時埋め）', () => {
    const windows = [dayWindow('2026-06-22'), dayWindow('2026-06-23')];
    const aBusy: Interval[] = [
      { start: jst('2026-06-22', '09:00'), end: jst('2026-06-22', '11:00') },
    ];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: aBusy },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 3,
    });
    for (const c of out) {
      const a = c.stages[0]!;
      // A の枠は 11:00 以降
      expect(a.start).toBeGreaterThanOrEqual(jst('2026-06-22', '11:00'));
    }
  });

  it('1ステージのみでも動作', () => {
    const windows = [dayWindow('2026-06-22')];
    const out = enumerateRelayCandidates({
      stages: [{ order: 1, label: 'X', workingWindows: windows, busy: [] }],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 4,
    });
    expect(out.length).toBe(4);
    expect(out[0]!.stages).toHaveLength(1);
  });

  it('maxCandidates の上限を尊重', () => {
    const windows = [
      dayWindow('2026-06-22'),
      dayWindow('2026-06-23'),
      dayWindow('2026-06-24'),
      dayWindow('2026-06-25'),
    ];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 3,
    });
    expect(out.length).toBe(3);
  });

  it('決定論：同じ入力 → 同じ出力', () => {
    const windows = [dayWindow('2026-06-22'), dayWindow('2026-06-23')];
    const args = {
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 5,
    };
    const a = enumerateRelayCandidates(args);
    const b = enumerateRelayCandidates(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('order の昇順でステージを評価する（入力順がバラバラでもOK）', () => {
    const windows = [dayWindow('2026-06-22')];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 3, label: 'C', workingWindows: windows, busy: [] },
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 30,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 2,
    });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.stages.map((s) => s.order)).toEqual([1, 2, 3]);
    }
  });

  it('連続候補の各枠は duration の長さ', () => {
    const windows = [dayWindow('2026-06-22'), dayWindow('2026-06-23')];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 45,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 3,
    });
    for (const c of out) {
      for (const s of c.stages) {
        expect(s.end - s.start).toBe(45 * 60 * 1000);
      }
    }
  });

  it('全ステージ同タイミングは却下（順序付き＝必ず後にずれる）', () => {
    const windows = [dayWindow('2026-06-22')];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: [] },
        { order: 2, label: 'B', workingWindows: windows, busy: [] },
      ],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
      maxCandidates: 5,
    });
    for (const c of out) {
      const a = c.stages[0]!;
      const b = c.stages[1]!;
      expect(b.start).toBeGreaterThan(a.start);
    }
  });
});

describe('relay-link domain edge cases', () => {
  it('空ステージは空配列', () => {
    const out = enumerateRelayCandidates({
      stages: [],
      durationMin: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
    });
    expect(out).toEqual([]);
  });

  it('A→B：A=月曜午前埋まり、B=月曜午後埋まり → 月曜は不成立', () => {
    const windows = [dayWindow('2026-06-22')];
    const aBusy: Interval[] = [
      { start: jst('2026-06-22', '09:00'), end: jst('2026-06-22', '12:00') },
    ];
    const bBusy: Interval[] = [
      { start: jst('2026-06-22', '12:00'), end: jst('2026-06-22', '18:00') },
    ];
    const out = enumerateRelayCandidates({
      stages: [
        { order: 1, label: 'A', workingWindows: windows, busy: aBusy },
        { order: 2, label: 'B', workingWindows: windows, busy: bBusy },
      ],
      durationMin: 60,
      bufferMinutes: 30,
      maxGapDays: 14,
      now: jst('2026-06-22', '00:00'),
    });
    // A は 12:00〜18:00, B は 9:00〜12:00。順序付き＝Aが先なので、Bは A.end+buffer 以降の枠が必要
    // → 月曜は不成立、候補なし
    expect(out.length).toBe(0);
  });
});

// 念のため未使用変数を消費（lint対策）
void HOUR;
