/**
 * 🟦 T3 投票型サービス（仕様 §5）。
 * 候補に○△×投票して、最多得票＋タイブレーク（earliest_start → participant_id_asc）で勝者を決める。
 * 投票記録自体は Repository に任せ、本ファイルは集計とタイブレーク適用を担う。
 */
import { rankCandidates, type RankedCandidate } from '../domain/tiebreak.js';
import type { Slot } from '../domain/types.js';
import type { CandidateRec, Repository, VoteTally } from '../repo/types.js';
import { ServiceError } from './errors.js';

/** 候補ごとの集計結果（API レスポンス向け）。 */
export interface VoteTallyDto {
  candidateId: string;
  slot: Slot;
  count: number;
}

/** 勝者（タイブレーク後・一意）。 */
export interface VoteWinner {
  candidateId: string;
  slot: Slot;
  count: number;
}

/** 内部：CandidateRec から RankedCandidate へ。participantId は安定キーとして candidate.id を使う。 */
function toRanked(tally: VoteTally): RankedCandidate {
  return {
    slot: { start: tally.candidate.start, end: tally.candidate.end },
    participantId: tally.candidate.id, // 候補ID自体を安定キーに（一意保証あり）
    score: tally.count,
  };
}

/**
 * 候補を1つ追加（既存と同一 slot は再利用＝重複登録しない）。
 * 投票開始前の候補列を組み立てる用途。
 */
export async function addVoteCandidate(
  repo: Repository,
  eventId: string,
  slot: Slot,
): Promise<CandidateRec> {
  return repo.addCandidate(eventId, slot);
}

/**
 * 投票を記録する。
 *  - 同一 (eventId, candidateId, voterId) は重複扱い＝既存を返す（二重投票無視）。
 *  - candidate が当該 event に属さなければ NOT_FOUND。
 */
export async function castVote(
  repo: Repository,
  eventId: string,
  candidateId: string,
  voterId: string,
): Promise<void> {
  const cands = await repo.listCandidates(eventId);
  if (!cands.some((c) => c.id === candidateId)) {
    throw new ServiceError('NOT_FOUND', '候補が見つかりません');
  }
  if (!voterId) throw new ServiceError('VALIDATION', 'voterId は必須です');
  await repo.castVote(eventId, candidateId, voterId);
}

/** 集計（候補一覧と得票数）。 */
export async function tallyVotes(repo: Repository, eventId: string): Promise<VoteTallyDto[]> {
  const tallies = await repo.tallyVotes(eventId);
  return tallies.map((t) => ({
    candidateId: t.candidate.id,
    slot: { start: t.candidate.start, end: t.candidate.end },
    count: t.count,
  }));
}

/**
 * 勝者を決める（タイブレーク：得票数降順 → earliest_start → candidate.id 昇順）。
 * 候補が0件、または全候補 0 票のときは null を返す（呼び出し側で表示判定）。
 *
 * 注：仕様の「participant_id_asc」は投票者IDではなく候補（参加候補）の安定キー＝
 * candidate.id を使う。これにより同点・同 start でも決定論的に一意に決まる。
 */
export async function pickWinner(
  repo: Repository,
  eventId: string,
): Promise<VoteWinner | null> {
  const tallies = await repo.tallyVotes(eventId);
  if (tallies.length === 0) return null;
  // 0 票しかない場合も「earliest_start」順で1つ提示する（仕様 §7-5 は全 0 でも一意決定）。
  const ranked = rankCandidates(tallies.map(toRanked));
  const top = ranked[0];
  if (!top) return null;
  // top.participantId は candidate.id
  const found = tallies.find((t) => t.candidate.id === top.participantId);
  if (!found) return null;
  return {
    candidateId: found.candidate.id,
    slot: { start: found.candidate.start, end: found.candidate.end },
    count: found.count,
  };
}
