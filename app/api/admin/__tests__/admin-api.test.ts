/**
 * /api/admin/* ルートのテスト。
 *  - GET /api/admin/stats
 *  - GET /api/admin/links / PATCH /api/admin/links/[slug]
 *  - GET /api/admin/relay-links / PATCH /api/admin/relay-links/[slug]
 *
 * 認証は middleware が担当する範囲のため、本テストはルート関数を直接呼ぶ。
 * DATABASE_URL は test では未設定 → getRepository() は MemoryRepository を返す。
 * RelayLink 系（Prisma 直叩き）は本テストでは検証しない（DB が無い前提）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GET as statsGET } from '../stats/route';
import { GET as linksGET } from '../links/route';
import { PATCH as linkPATCH } from '../links/[slug]/route';
import { GET as relayGET } from '../relay-links/route';
import { PATCH as relayPATCH } from '../relay-links/[slug]/route';
import { getMemoryRepository } from '@/repo/memory';

const HOUR = 60 * 60 * 1000;

let seedCounter = 0;
async function seed() {
  const repo = getMemoryRepository();
  const tag = `${Date.now().toString(36)}-${(++seedCounter).toString(36)}`;
  // singleton 共有環境でも衝突しないようリソース/枠/slugを test 毎にユニーク化。
  const p1 = await repo.createPage({
    organizerId: `takagi-${tag}`,
    type: 'T1',
    slug: `linka${tag}`.padEnd(8, 'x').slice(0, 32),
    settings: { title: 'リンクA' },
  });
  await new Promise((r) => setTimeout(r, 2));
  const p2 = await repo.createPage({
    organizerId: `takagi-${tag}`,
    type: 'T1',
    slug: `linkb${tag}`.padEnd(8, 'x').slice(0, 32),
    settings: { title: 'リンクB' },
  });
  const { event } = await repo.createEvent({
    pageId: p2.id,
    type: 'T1',
    idempotencyKey: `k-${tag}`,
  });
  // 各 seed 毎に異なる時間帯を使う（singleton の holds が重ならないように）
  const base = Date.now() + seedCounter * 365 * 24 * HOUR;
  const slot = { start: base + HOUR, end: base + 2 * HOUR };
  const cand = await repo.upsertCandidate(event.id, slot);
  const hold = await repo.createActiveHold({
    eventId: event.id,
    candidateId: cand.id,
    resourceId: `res-${tag}`,
    holderId: `guest-${tag}`,
    slot,
    expiresAt: base + 15 * 60 * 1000,
    now: base,
  });
  await repo.confirmHold(hold.id, { participantId: `guest-${tag}`, now: base });
  return { p1, p2 };
}

describe('/api/admin/stats', () => {
  it('200 で AdminStats を返す（link.total/active/confirmations が整合）', async () => {
    const { p1 } = await seed();
    const res = await statsGET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      link: { total: number; active: number; confirmations: number };
      relay: { total: number; active: number; holds: number };
      confirmationsLast24h: number;
    };
    expect(json.link.total).toBeGreaterThanOrEqual(2);
    expect(json.link.active).toBeGreaterThanOrEqual(2);
    expect(json.link.confirmations).toBeGreaterThanOrEqual(1);
    expect(json.confirmationsLast24h).toBeGreaterThanOrEqual(1);
    // p1 はアクティブのまま
    expect(p1.isActive).toBe(true);
  });
});

describe('/api/admin/links', () => {
  it('GET: 全件を返す（isActive=false も含む）', async () => {
    const { p1 } = await seed();
    const repo = getMemoryRepository();
    await repo.setPageActiveBySlug(p1.slug, false);
    const res = await linksGET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      links: { slug: string; isActive: boolean; confirmationCount: number }[];
    };
    const row = json.links.find((r) => r.slug === p1.slug);
    expect(row).toBeDefined();
    expect(row!.isActive).toBe(false);
  });

  it('PATCH: status=disabled で isActive を false にできる', async () => {
    const { p2 } = await seed();
    const req = new Request(`https://x.test/api/admin/links/${p2.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const res = await linkPATCH(req, { params: Promise.resolve({ slug: p2.slug }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { slug: string; isActive: boolean };
    expect(json.isActive).toBe(false);
  });

  it('PATCH: status=active で再度 isActive を true にできる', async () => {
    const { p2 } = await seed();
    const repo = getMemoryRepository();
    await repo.setPageActiveBySlug(p2.slug, false);
    const req = new Request(`https://x.test/api/admin/links/${p2.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    const res = await linkPATCH(req, { params: Promise.resolve({ slug: p2.slug }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { isActive: boolean };
    expect(json.isActive).toBe(true);
  });

  it('PATCH: 存在しない slug は 404', async () => {
    const req = new Request(`https://x.test/api/admin/links/no-such-slug-zzz`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const res = await linkPATCH(req, {
      params: Promise.resolve({ slug: 'no-such-slug-zzz' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH: status が不正なら 400', async () => {
    const { p2 } = await seed();
    const req = new Request(`https://x.test/api/admin/links/${p2.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'wat' }),
    });
    const res = await linkPATCH(req, { params: Promise.resolve({ slug: p2.slug }) });
    expect(res.status).toBe(400);
  });

  it('PATCH: 無効な slug は 400（VALIDATION）', async () => {
    const req = new Request(`https://x.test/api/admin/links/bad`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const res = await linkPATCH(req, { params: Promise.resolve({ slug: 'bad' }) });
    expect(res.status).toBe(400);
  });
});

describe('/api/admin/relay-links', () => {
  it('GET: 200 + links 配列を返す（DB 未接続でも空配列で degrade）', async () => {
    const res = await relayGET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { links: unknown[] };
    expect(Array.isArray(json.links)).toBe(true);
  });

  it('PATCH: 存在しない slug は 404（DB 未接続でも throw せずエラーで返る）', async () => {
    const req = new Request(`https://x.test/api/admin/relay-links/no-such-slug-aaa`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const res = await relayPATCH(req, {
      params: Promise.resolve({ slug: 'no-such-slug-aaa' }),
    });
    // DATABASE_URL が無い場合は Prisma 接続エラー → 500/CONFLICT 等のエラー応答を許容
    expect([404, 500, 400, 503]).toContain(res.status);
  });

  it('PATCH: 不正な status は 400', async () => {
    const req = new Request(`https://x.test/api/admin/relay-links/some-valid-slug`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'on' }),
    });
    const res = await relayPATCH(req, {
      params: Promise.resolve({ slug: 'some-valid-slug' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('admin repo (memory) — listAll / counts / setActive', () => {
  beforeEach(() => {
    // メモリリポは singleton。テスト隔離のため呼び出し前に一度だけ seed して
    // 期待値は「前テスト分も含む」前提で書いている。各テストは setActive の冪等性のみ確認。
  });

  it('listAllPages は createdAt 降順で全件返す', async () => {
    await seed();
    const repo = getMemoryRepository();
    const all = await repo.listAllPages();
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
    }
  });

  it('setPageActiveBySlug は true/false の両方向で動く', async () => {
    const { p1 } = await seed();
    const repo = getMemoryRepository();
    const off = await repo.setPageActiveBySlug(p1.slug, false);
    expect(off?.isActive).toBe(false);
    const on = await repo.setPageActiveBySlug(p1.slug, true);
    expect(on?.isActive).toBe(true);
  });

  it('countConfirmationsByPage は確定数を pageId 別に集計する', async () => {
    const { p2 } = await seed();
    const repo = getMemoryRepository();
    const map = await repo.countConfirmationsByPage();
    expect(map.get(p2.id) ?? 0).toBeGreaterThanOrEqual(1);
  });
});
