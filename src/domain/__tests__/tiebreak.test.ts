import { describe, it, expect } from 'vitest';
import { pickWinner, rankCandidates, type RankedCandidate } from '../tiebreak.js';
import type { Slot } from '../types.js';

const slot = (h: number): Slot => ({
  start: Date.UTC(2026, 5, 15, h, 0, 0),
  end: Date.UTC(2026, 5, 15, h, 30, 0),
});

describe('tiebreak（§7-5・乱数不使用）', () => {
  it('score 降順が最優先', () => {
    const c: RankedCandidate[] = [
      { slot: slot(9), participantId: 'p1', score: 2 },
      { slot: slot(10), participantId: 'p2', score: 5 },
    ];
    expect(pickWinner(c)!.participantId).toBe('p2');
  });

  it('同点は earliest_start で決まる（§22 投票同数）', () => {
    const c: RankedCandidate[] = [
      { slot: slot(11), participantId: 'pB', score: 3 },
      { slot: slot(9), participantId: 'pA', score: 3 },
    ];
    expect(pickWinner(c)!.slot).toEqual(slot(9));
  });

  it('start も同点なら participantId 昇順', () => {
    const c: RankedCandidate[] = [
      { slot: slot(9), participantId: 'pZ', score: 1 },
      { slot: slot(9), participantId: 'pA', score: 1 },
    ];
    expect(pickWinner(c)!.participantId).toBe('pA');
  });

  it('入力順を変えても結果は同じ（決定論）', () => {
    const base: RankedCandidate[] = [
      { slot: slot(9), participantId: 'pA', score: 1 },
      { slot: slot(10), participantId: 'pB', score: 1 },
      { slot: slot(9), participantId: 'pC', score: 1 },
    ];
    const r1 = rankCandidates(base).map((x) => x.participantId);
    const r2 = rankCandidates([...base].reverse()).map((x) => x.participantId);
    expect(r1).toEqual(r2);
  });
});
