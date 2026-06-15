/**
 * RelayLink サービス層のテスト。
 * computeRelayCandidates: busyByStage を注入できるためGoogle連携なしで確認できる。
 */
import { describe, it, expect } from 'vitest';
import {
  computeRelayCandidates,
  validateRelayStages,
  generateSlug,
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
