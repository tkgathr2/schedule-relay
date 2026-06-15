/**
 * RelayLink サービス層のテスト。
 * computeRelayCandidates: busyByStage を注入できるためGoogle連携なしで確認できる。
 */
import { describe, it, expect } from 'vitest';
import {
  computeRelayCandidates,
  validateRelayStages,
  generateSlug,
  summarizeHolds,
  countHoldsByStage,
  type RelayHoldRow,
} from '../relay-link.js';
import type { Interval } from '../../domain/types.js';

const JST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function jst(yyyymmdd: string, hhmm: string): number {
  const [y, m, d] = yyyymmdd.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(y, m - 1, d, h, mi) - JST_OFFSET;
}

describe('validateRelayStages', () => {
  it('正常入力で null', () => {
    expect(
      validateRelayStages([
        { order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: ['primary'] },
        { order: 2, label: 'B', ownerEmail: 'b@x.com', calendarIds: [] },
      ]),
    ).toBeNull();
  });
  it('空配列でエラー', () => {
    expect(validateRelayStages([])).not.toBeNull();
  });
  it('重複 order でエラー', () => {
    const e = validateRelayStages([
      { order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] },
      { order: 1, label: 'B', ownerEmail: 'b@x.com', calendarIds: [] },
    ]);
    expect(e).toMatch(/重複/);
  });
  it('label 欠落でエラー', () => {
    const e = validateRelayStages([
      { order: 1, label: '', ownerEmail: 'a@x.com', calendarIds: [] },
    ]);
    expect(e).toMatch(/label/);
  });
  it('ownerEmail 不正でエラー', () => {
    const e = validateRelayStages([
      { order: 1, label: 'A', ownerEmail: 'notanemail', calendarIds: [] },
    ]);
    expect(e).toMatch(/ownerEmail/);
  });
  it('order < 1 でエラー', () => {
    const e = validateRelayStages([
      { order: 0, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] },
    ]);
    expect(e).toMatch(/order/);
  });
});

describe('generateSlug', () => {
  it('12文字を返す', () => {
    expect(generateSlug()).toHaveLength(12);
  });
  it('30回呼んで全て異なる確率が高い', () => {
    const set = new Set<string>();
    for (let i = 0; i < 30; i++) set.add(generateSlug());
    expect(set.size).toBeGreaterThan(25);
  });
});

describe('computeRelayCandidates', () => {
  it('busyByStage が空 → 営業時間ベースで候補を返す', () => {
    const now = jst('2026-06-22', '00:00');
    const out = computeRelayCandidates({
      stages: [
        { order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] },
        { order: 2, label: 'B', ownerEmail: 'b@x.com', calendarIds: [] },
      ],
      durationMinutes: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      startDate: now,
      endDate: now + 5 * DAY,
      busyByStage: new Map(),
      now,
      maxCandidates: 3,
    });
    expect(out.length).toBe(3);
    expect(out[0]!.stages).toHaveLength(2);
  });

  it('busyByStage に注入した busy を尊重', () => {
    const now = jst('2026-06-22', '00:00');
    const aBusy: Interval[] = [
      { start: jst('2026-06-22', '09:00'), end: jst('2026-06-22', '15:00') },
    ];
    const busyByStage = new Map<number, Interval[]>([[1, aBusy]]);
    const out = computeRelayCandidates({
      stages: [
        { order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] },
        { order: 2, label: 'B', ownerEmail: 'b@x.com', calendarIds: [] },
      ],
      durationMinutes: 60,
      bufferMinutes: 15,
      maxGapDays: 14,
      startDate: now,
      endDate: now + 3 * DAY,
      busyByStage,
      now,
      maxCandidates: 5,
    });
    expect(out.length).toBeGreaterThan(0);
    // 最初の候補のAは 月曜15:00以降か火曜以降
    const firstA = out[0]!.stages[0]!;
    expect(firstA.start).toBeGreaterThanOrEqual(jst('2026-06-22', '15:00'));
  });

  it('periodEnd <= periodStart → 空配列', () => {
    const now = jst('2026-06-22', '00:00');
    const out = computeRelayCandidates({
      stages: [{ order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] }],
      durationMinutes: 60,
      startDate: now + DAY,
      endDate: now, // 逆
      busyByStage: new Map(),
      now,
    });
    expect(out).toEqual([]);
  });

  it('長期間でもmaxCandidatesで停止', () => {
    const now = jst('2026-06-22', '00:00');
    const out = computeRelayCandidates({
      stages: [
        { order: 1, label: 'A', ownerEmail: 'a@x.com', calendarIds: [] },
        { order: 2, label: 'B', ownerEmail: 'b@x.com', calendarIds: [] },
        { order: 3, label: 'C', ownerEmail: 'c@x.com', calendarIds: [] },
      ],
      durationMinutes: 30,
      bufferMinutes: 15,
      maxGapDays: 30,
      startDate: now,
      endDate: now + 30 * DAY,
      busyByStage: new Map(),
      now,
      maxCandidates: 7,
    });
    expect(out.length).toBe(7);
  });
});

describe('summarizeHolds', () => {
  const baseRow = (over: Partial<RelayHoldRow>): RelayHoldRow => ({
    id: 'h1',
    stageOrder: 1,
    stageLabel: 'A',
    ownerEmail: 'a@x.com',
    startAt: new Date('2026-07-01T01:00:00.000Z'),
    endAt: new Date('2026-07-01T02:00:00.000Z'),
    status: 'provisional',
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    ...over,
  });

  it('空配列なら空を返す', () => {
    expect(summarizeHolds([])).toEqual([]);
  });

  it('stageOrder昇順 → startAt昇順 で並べる', () => {
    const rows: RelayHoldRow[] = [
      baseRow({ id: 'b2', stageOrder: 2, startAt: new Date('2026-07-02T01:00:00Z') }),
      baseRow({ id: 'a2', stageOrder: 1, startAt: new Date('2026-07-03T01:00:00Z') }),
      baseRow({ id: 'a1', stageOrder: 1, startAt: new Date('2026-07-01T01:00:00Z') }),
    ];
    const out = summarizeHolds(rows);
    expect(out.map((r) => r.id)).toEqual(['a1', 'a2', 'b2']);
  });

  it('Date を ISO 文字列に整形する', () => {
    const out = summarizeHolds([
      baseRow({
        id: 'h1',
        startAt: new Date('2026-07-01T01:00:00.000Z'),
        endAt: new Date('2026-07-01T02:30:00.000Z'),
        createdAt: new Date('2026-06-15T12:00:00.000Z'),
      }),
    ]);
    expect(out[0]?.start).toBe('2026-07-01T01:00:00.000Z');
    expect(out[0]?.end).toBe('2026-07-01T02:30:00.000Z');
    expect(out[0]?.createdAt).toBe('2026-06-15T12:00:00.000Z');
  });

  it('入力配列を破壊しない（純関数）', () => {
    const rows: RelayHoldRow[] = [
      baseRow({ id: 'b', stageOrder: 2 }),
      baseRow({ id: 'a', stageOrder: 1 }),
    ];
    const before = rows.map((r) => r.id);
    summarizeHolds(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('countHoldsByStage', () => {
  const stages = [
    { order: 1, label: 'A' },
    { order: 2, label: 'B' },
    { order: 3, label: 'C' },
  ];
  const row = (order: number, id: string): RelayHoldRow => ({
    id,
    stageOrder: order,
    stageLabel: `S${order}`,
    ownerEmail: 'x@x.com',
    startAt: new Date('2026-07-01T01:00:00Z'),
    endAt: new Date('2026-07-01T02:00:00Z'),
    status: 'provisional',
    createdAt: new Date('2026-06-20T00:00:00Z'),
  });

  it('全ステージを 0 件で初期化する', () => {
    const out = countHoldsByStage([], stages);
    expect(out).toEqual([
      { stageOrder: 1, stageLabel: 'A', count: 0 },
      { stageOrder: 2, stageLabel: 'B', count: 0 },
      { stageOrder: 3, stageLabel: 'C', count: 0 },
    ]);
  });

  it('行を stage 単位で件数集計する', () => {
    const rows = [row(1, 'a1'), row(1, 'a2'), row(2, 'b1')];
    const out = countHoldsByStage(rows, stages);
    expect(out).toEqual([
      { stageOrder: 1, stageLabel: 'A', count: 2 },
      { stageOrder: 2, stageLabel: 'B', count: 1 },
      { stageOrder: 3, stageLabel: 'C', count: 0 },
    ]);
  });

  it('order 昇順で返す', () => {
    const reversed = [
      { order: 3, label: 'C' },
      { order: 1, label: 'A' },
      { order: 2, label: 'B' },
    ];
    const out = countHoldsByStage([row(2, 'x')], reversed);
    expect(out.map((c) => c.stageOrder)).toEqual([1, 2, 3]);
    expect(out.find((c) => c.stageOrder === 2)?.count).toBe(1);
  });
});
