/**
 * タイブレーク（仕様 §7-5）。
 * 候補が同点のときの優先順位を一意に固定する。乱数は使わない。
 * 既定規則：earliest_start → participant_id 昇順。
 */
import type { Slot } from './types.js';

export interface RankedCandidate {
  readonly slot: Slot;
  /** 関連付けられた参加者ID（同一枠の比較に使う安定キー）。 */
  readonly participantId: string;
  /** 得票数など、タイプ別の主スコア（多いほど優先）。未使用なら 0。 */
  readonly score?: number;
}

/**
 * 決定論的比較関数。
 * 1) score 降順（大きいほど優先）→ 2) start 昇順 → 3) participantId 昇順。
 * すべての値が等しいときのみ 0（実運用では participantId が一意なので 0 にならない）。
 */
export function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  const sa = a.score ?? 0;
  const sb = b.score ?? 0;
  if (sa !== sb) return sb - sa; // score 降順
  if (a.slot.start !== b.slot.start) return a.slot.start - b.slot.start; // 早い開始
  return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;
}

/** 候補を決定論順に整列。入力順に依存しない。 */
export function rankCandidates(cands: readonly RankedCandidate[]): RankedCandidate[] {
  return [...cands].sort(compareCandidates);
}

/** 勝者を一意決定。空なら null。 */
export function pickWinner(cands: readonly RankedCandidate[]): RankedCandidate | null {
  if (cands.length === 0) return null;
  return rankCandidates(cands)[0]!;
}
