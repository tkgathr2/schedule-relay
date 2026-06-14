import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '../../repo/memory.js';
import { addVoteCandidate, castVote, pickWinner, tallyVotes } from '../vote.js';
import { ServiceError } from '../errors.js';

const NOW = Date.UTC(2026, 5, 14, 15, 0);

async function setup(): Promise<{ repo: MemoryRepository; eventId: string }> {
  const repo = new MemoryRepository();
  const page = await repo.createPage({
    organizerId: 'org-x',
    type: 'T3',
    slug: 't3-page',
    settings: {},
  });
  const { event } = await repo.createEvent({ pageId: page.id, type: 'T3', idempotencyKey: null });
  return { repo, eventId: event.id };
}

describe('T3 vote service', () => {
  let repo: MemoryRepository;
  let eventId: string;

  beforeEach(async () => {
    const s = await setup();
    repo = s.repo;
    eventId = s.eventId;
  });

  it('集計：投票が無いと count=0 で全候補が並ぶ', async () => {
    const c1 = await addVoteCandidate(repo, eventId, { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 });
    const c2 = await addVoteCandidate(repo, eventId, { start: NOW + 7200000, end: NOW + 7200000 + 30 * 60000 });
    const tally = await tallyVotes(repo, eventId);
    expect(tally).toHaveLength(2);
    expect(tally.map((t) => t.count)).toEqual([0, 0]);
    expect(tally[0]!.candidateId).toBe(c1.id);
    expect(tally[1]!.candidateId).toBe(c2.id);
  });

  it('投票記録：同一 voter の重複投票は1件のみ', async () => {
    const c1 = await addVoteCandidate(repo, eventId, { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 });
    await castVote(repo, eventId, c1.id, 'alice');
    await castVote(repo, eventId, c1.id, 'alice'); // 重複
    await castVote(repo, eventId, c1.id, 'bob');
    const tally = await tallyVotes(repo, eventId);
    expect(tally[0]!.count).toBe(2);
  });

  it('未知の candidateId は NOT_FOUND', async () => {
    await expect(castVote(repo, eventId, 'cand_unknown', 'alice')).rejects.toBeInstanceOf(ServiceError);
  });

  it('勝者：得票数降順で決まる', async () => {
    const c1 = await addVoteCandidate(repo, eventId, { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 });
    const c2 = await addVoteCandidate(repo, eventId, { start: NOW + 7200000, end: NOW + 7200000 + 30 * 60000 });
    await castVote(repo, eventId, c1.id, 'a');
    await castVote(repo, eventId, c2.id, 'a');
    await castVote(repo, eventId, c2.id, 'b');
    const w = await pickWinner(repo, eventId);
    expect(w?.candidateId).toBe(c2.id);
    expect(w?.count).toBe(2);
  });

  it('タイブレーク：得票数同点なら earliest_start が勝つ', async () => {
    const cEarly = await addVoteCandidate(repo, eventId, { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 });
    const cLate = await addVoteCandidate(repo, eventId, { start: NOW + 7200000, end: NOW + 7200000 + 30 * 60000 });
    await castVote(repo, eventId, cEarly.id, 'a');
    await castVote(repo, eventId, cLate.id, 'b');
    const w = await pickWinner(repo, eventId);
    expect(w?.candidateId).toBe(cEarly.id); // start が早い方が勝つ
  });

  it('全員0票でも earliest_start で1つに決まる（決定論）', async () => {
    const cEarly = await addVoteCandidate(repo, eventId, { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 });
    await addVoteCandidate(repo, eventId, { start: NOW + 7200000, end: NOW + 7200000 + 30 * 60000 });
    const w = await pickWinner(repo, eventId);
    expect(w?.candidateId).toBe(cEarly.id);
    expect(w?.count).toBe(0);
  });

  it('候補無しなら勝者は null', async () => {
    const w = await pickWinner(repo, eventId);
    expect(w).toBeNull();
  });

  it('addVoteCandidate は同一 slot を重複登録しない（upsert）', async () => {
    const slot = { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 };
    const c1 = await addVoteCandidate(repo, eventId, slot);
    const c2 = await addVoteCandidate(repo, eventId, slot);
    expect(c1.id).toBe(c2.id);
    const list = await repo.listCandidates(eventId);
    expect(list).toHaveLength(1);
  });
});
