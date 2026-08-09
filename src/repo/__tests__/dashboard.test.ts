/**
 * 一覧系（ダッシュボード用）リポメソッドのテスト。
 *  - listPagesByOrganizer
 *  - listEventsByStatus
 *  - listConfirmationsFiltered
 *  - deactivatePageBySlug
 */
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../memory.js';

const HOUR = 60 * 60 * 1000;

async function setup() {
  const repo = new MemoryRepository();
  // 主催者2人・ページ3枚（takagi 2枚 + tanaka 1枚）
  const p1 = await repo.createPage({
    organizerId: 'takagi',
    type: 'T1',
    slug: 'biz-30',
    settings: { title: '30分商談', duration_minutes: 30 },
  });
  // createdAt が同じ ms に潰れて並びがブレるのを避けるため小休止
  await new Promise((r) => setTimeout(r, 2));
  const p2 = await repo.createPage({
    organizerId: 'takagi',
    type: 'T1',
    slug: 'biz-60',
    settings: { title: '60分面談', duration_minutes: 60 },
  });
  await new Promise((r) => setTimeout(r, 2));
  const p3 = await repo.createPage({
    organizerId: 'tanaka',
    type: 'T1',
    slug: 'tanaka-1',
    settings: { title: 'tanakaの調整' },
  });

  // takagi に open + holding + confirmed を1件ずつ作る
  const { event: evOpen } = await repo.createEvent({
    pageId: p1.id,
    type: 'T1',
    idempotencyKey: 'k-open',
  });
  const { event: evConf } = await repo.createEvent({
    pageId: p1.id,
    type: 'T1',
    idempotencyKey: 'k-conf',
  });
  // confirmed イベントに Hold→Confirm
  const now = Date.now();
  const cand = await repo.upsertCandidate(evConf.id, { start: now + HOUR, end: now + 2 * HOUR });
  const { hold } = await repo.createActiveHold({
    eventId: evConf.id,
    candidateId: cand.id,
    resourceId: 'takagi',
    holderId: 'guest',
    slot: { start: cand.start, end: cand.end },
    expiresAt: now + 15 * 60 * 1000,
    now,
  });
  await repo.confirmHold(hold.id, { participantId: 'guest', now });

  return { repo, p1, p2, p3, evOpen };
}

describe('dashboard repo methods', () => {
  it('listPagesByOrganizer: 指定主催者のページだけを createdAt 降順で返す', async () => {
    const { repo } = await setup();
    const pages = await repo.listPagesByOrganizer('takagi');
    expect(pages.length).toBe(2);
    expect(pages.every((p) => p.organizerId === 'takagi')).toBe(true);
    // 後で作った biz-60 が先頭
    expect(pages[0]!.slug).toBe('biz-60');
    expect(pages[1]!.slug).toBe('biz-30');
  });

  it('listPagesByOrganizer: 存在しない主催者は空配列', async () => {
    const { repo } = await setup();
    const pages = await repo.listPagesByOrganizer('unknown');
    expect(pages).toEqual([]);
  });

  it('listEventsByStatus: status filter が効く（open のみ）', async () => {
    const { repo } = await setup();
    const opens = await repo.listEventsByStatus(['open']);
    expect(opens.length).toBe(1);
    expect(opens[0]!.status).toBe('open');
  });

  it('listEventsByStatus: 複数 status を OR 集約', async () => {
    const { repo } = await setup();
    const mixed = await repo.listEventsByStatus(['open', 'confirmed']);
    expect(mixed.length).toBe(2);
    const statuses = mixed.map((e) => e.status).sort();
    expect(statuses).toEqual(['confirmed', 'open']);
  });

  it('listConfirmationsFiltered: organizerId で絞り込み', async () => {
    const { repo } = await setup();
    const takagi = await repo.listConfirmationsFiltered({ organizerId: 'takagi' });
    expect(takagi.length).toBe(1);
    const tanaka = await repo.listConfirmationsFiltered({ organizerId: 'tanaka' });
    expect(tanaka.length).toBe(0);
  });

  it('listConfirmationsFiltered: fromMs で start >= fromMs にカット', async () => {
    const { repo } = await setup();
    const all = await repo.listConfirmationsFiltered({});
    expect(all.length).toBe(1);
    // 未来 fromMs にすると 0 件
    const future = await repo.listConfirmationsFiltered({ fromMs: Date.now() + 10 * HOUR });
    expect(future.length).toBe(0);
  });

  it('deactivatePageBySlug: isActive を false に', async () => {
    const { repo } = await setup();
    const before = await repo.getPageBySlug('biz-30');
    expect(before?.isActive).toBe(true);
    const updated = await repo.deactivatePageBySlug('biz-30');
    expect(updated?.isActive).toBe(false);
    const after = await repo.getPageBySlug('biz-30');
    expect(after?.isActive).toBe(false);
  });

  it('deactivatePageBySlug: 存在しなければ null', async () => {
    const { repo } = await setup();
    const r = await repo.deactivatePageBySlug('nope');
    expect(r).toBeNull();
  });
});
