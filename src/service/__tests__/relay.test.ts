import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '../../repo/memory.js';
import {
  advanceStep,
  computeNextCandidate,
  createRelay,
  listSteps,
  relayStatus,
  rollbackStep,
} from '../relay.js';
import { ServiceError } from '../errors.js';

const NOW = Date.UTC(2026, 5, 14, 15, 0);
const slot10 = { start: NOW + 3600000, end: NOW + 3600000 + 30 * 60000 };
const slot11 = { start: NOW + 7200000, end: NOW + 7200000 + 30 * 60000 };

async function setupRelay(
  subMode: 'converge' | 'chained' | 'independent',
): Promise<{ repo: MemoryRepository; eventId: string; stepIds: string[] }> {
  const repo = new MemoryRepository();
  const page = await repo.createPage({
    organizerId: 'org-y',
    type: 'T6',
    slug: 't6-page',
    settings: {},
  });
  const { event } = await repo.createEvent({ pageId: page.id, type: 'T6', idempotencyKey: null });
  const created = await createRelay(repo, event.id, [
    { order: 0, assigneeId: 'alice', subMode },
    { order: 1, assigneeId: 'bob', subMode },
    { order: 2, assigneeId: 'carol', subMode },
  ]);
  return { repo, eventId: event.id, stepIds: created.map((s) => s.id) };
}

describe('T6 relay service - createRelay', () => {
  it('order が連番でないと VALIDATION', async () => {
    const repo = new MemoryRepository();
    const page = await repo.createPage({
      organizerId: 'org-z',
      type: 'T6',
      slug: 't6-bad',
      settings: {},
    });
    const { event } = await repo.createEvent({ pageId: page.id, type: 'T6', idempotencyKey: null });
    await expect(
      createRelay(repo, event.id, [
        { order: 0, assigneeId: 'a', subMode: 'converge' },
        { order: 2, assigneeId: 'b', subMode: 'converge' }, // 1 を飛ばしている
      ]),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('生成直後：先頭=active、残り=waiting', async () => {
    const { repo, eventId } = await setupRelay('converge');
    const steps = await listSteps(repo, eventId);
    expect(steps[0]!.status).toBe('active');
    expect(steps[1]!.status).toBe('waiting');
    expect(steps[2]!.status).toBe('waiting');
  });
});

describe('T6 relay service - converge', () => {
  it('正常系：A→B→C で全員確定し confirmed になる', async () => {
    const { repo, eventId, stepIds } = await setupRelay('converge');
    // A が枠を確定
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    let steps = await repo.getRelaySteps(eventId);
    expect(steps[0]!.status).toBe('done');
    expect(steps[1]!.status).toBe('active');

    // B は同一枠でないと拒否される（CONFLICT_HOLD）
    await expect(advanceStep(repo, eventId, stepIds[1]!, slot11)).rejects.toBeInstanceOf(ServiceError);

    // B が A と同じ枠を受諾
    await advanceStep(repo, eventId, stepIds[1]!, slot10);
    // C も同じ枠を受諾
    await advanceStep(repo, eventId, stepIds[2]!, slot10);

    steps = await repo.getRelaySteps(eventId);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(relayStatus(steps)).toBe('confirmed');
  });

  it('active でないステップを advance すると FORBIDDEN', async () => {
    const { repo, eventId, stepIds } = await setupRelay('converge');
    await expect(advanceStep(repo, eventId, stepIds[1]!, slot10)).rejects.toBeInstanceOf(ServiceError);
  });

  it('rollback：B を done にしてから A まで戻すと convergeSlot もリセット相当（B 以降は waiting）', async () => {
    const { repo, eventId, stepIds } = await setupRelay('converge');
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    await advanceStep(repo, eventId, stepIds[1]!, slot10);
    // 今は C が active

    // A を差し戻し → A=active、B/C=waiting、A の slot もクリア
    await rollbackStep(repo, eventId, stepIds[0]!);
    const steps = await repo.getRelaySteps(eventId);
    expect(steps[0]!.status).toBe('active');
    expect(steps[0]!.slotStart).toBeNull();
    expect(steps[1]!.status).toBe('waiting');
    expect(steps[2]!.status).toBe('waiting');
  });

  it('computeNextCandidate(converge)：先頭確定後は強制枠が返る', async () => {
    const { repo, eventId, stepIds } = await setupRelay('converge');
    // 何もしてない状態：強制枠は null
    let nc = await computeNextCandidate(repo, eventId);
    expect(nc?.enforcedSlot).toBeNull();
    // A が確定
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    nc = await computeNextCandidate(repo, eventId);
    expect(nc?.enforcedSlot).toEqual(slot10);
  });
});

describe('T6 relay service - chained', () => {
  it('直前の終了時刻 + gap が次の候補開始になる（gap=0）', async () => {
    const { repo, eventId, stepIds } = await setupRelay('chained');
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    const nc = await computeNextCandidate(repo, eventId, 30, 0);
    // slot10 end = NOW+3600000+30*60000 = end. その直後+0、+30min が end。
    expect(nc?.enforcedSlot).toEqual({ start: slot10.end, end: slot10.end + 30 * 60000 });
  });

  it('chained でも別枠で確定可能（converge のような同一枠強制は無い）', async () => {
    const { repo, eventId, stepIds } = await setupRelay('chained');
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    // B は別の枠を確定できる（converge と違って拒否されない）
    await advanceStep(repo, eventId, stepIds[1]!, slot11);
    const steps = await repo.getRelaySteps(eventId);
    expect(steps[1]!.slotStart).toBe(slot11.start);
  });
});

describe('T6 relay service - independent', () => {
  it('independent：各自が自由に枠を選べる', async () => {
    const { repo, eventId, stepIds } = await setupRelay('independent');
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    await advanceStep(repo, eventId, stepIds[1]!, slot11);
    const steps = await repo.getRelaySteps(eventId);
    expect(steps[0]!.slotStart).toBe(slot10.start);
    expect(steps[1]!.slotStart).toBe(slot11.start);
  });

  it('independent：computeNextCandidate は enforcedSlot=null', async () => {
    const { repo, eventId, stepIds } = await setupRelay('independent');
    await advanceStep(repo, eventId, stepIds[0]!, slot10);
    const nc = await computeNextCandidate(repo, eventId);
    expect(nc?.enforcedSlot).toBeNull();
  });
});

describe('T6 relay service - rollback edge cases', () => {
  it('done でないステップを rollback すると NOT_FOUND', async () => {
    const { repo, eventId, stepIds } = await setupRelay('converge');
    // stepIds[0] は active なので done ではない
    await expect(rollbackStep(repo, eventId, stepIds[0]!)).rejects.toBeInstanceOf(ServiceError);
  });

  it('未知の stepId を rollback すると NOT_FOUND', async () => {
    const { repo, eventId } = await setupRelay('converge');
    await expect(rollbackStep(repo, eventId, 'rstep_unknown')).rejects.toBeInstanceOf(ServiceError);
  });
});
