import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '../../repo/memory.js';
import {
  availabilityForPage,
  liveAvailabilityForPage,
  createEventForPage,
  holdSlot,
  confirmHold,
} from '../booking.js';
import { ServiceError, type ServiceErrorCode } from '../errors.js';
import { expandWorkingWindows } from '../../domain/working-hours.js';
import type { BookingPageRec } from '../../repo/types.js';

// 決定論的な基準時刻：2026-06-15(月) 00:00 JST = 2026-06-14 15:00 UTC
const NOW = Date.UTC(2026, 5, 14, 15, 0);
const MIN = 60 * 1000;

// 2026-06-15 JST の各時刻（UTC epoch）
const jst = (h: number, m = 0) => Date.UTC(2026, 5, 15, h - 9, m);
const SLOT_10 = { start: jst(10, 0), end: jst(10, 30) }; // 10:00-10:30 JST
const SLOT_11 = { start: jst(11, 0), end: jst(11, 30) };

const baseSettings = {
  duration_minutes: 30,
  grid_minutes: 15,
  min_notice_minutes: 0,
  working_hours: { tz: 'Asia/Tokyo', mon_fri: ['09:00', '18:00'], sat: [], sun: [] },
  hold_ttl_minutes: 15,
};

async function makePage(repo: MemoryRepository, settings: object = baseSettings): Promise<BookingPageRec> {
  return repo.createPage({ organizerId: 'org-takagi', type: 'T2', slug: 'takagi', settings });
}

async function expectCode(code: ServiceErrorCode, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error(`expected ServiceError(${code}) but none thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).code).toBe(code);
  }
}

describe('availability', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('受付時間内で30分・15分グリッドの枠を返す', async () => {
    const page = await makePage(repo);
    const slots = availabilityForPage(page, NOW);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.end - s.start).toBe(30 * MIN);
      expect(s.start % (15 * MIN)).toBe(0);
    }
    // 既知の枠が含まれる
    expect(slots.some((s) => s.start === SLOT_10.start && s.end === SLOT_10.end)).toBe(true);
  });

  it('全ての枠が営業時間ウィンドウ内に収まる（18:00以降は出ない）', async () => {
    const page = await makePage(repo);
    const slots = availabilityForPage(page, NOW);
    const windows = expandWorkingWindows(
      { tz: 'Asia/Tokyo', mon_fri: ['09:00', '18:00'], sat: [], sun: [] },
      NOW,
      14,
    );
    for (const s of slots) {
      const inside = windows.some((w) => s.start >= w.start && s.end <= w.end);
      expect(inside).toBe(true);
    }
  });
});

describe('動的な空き（取られた枠が消える）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('確定済みの枠は live 空きから消える', async () => {
    const page = await makePage(repo);
    const before = await liveAvailabilityForPage(repo, page, NOW);
    expect(before.some((s) => s.start === SLOT_10.start)).toBe(true);

    const { event } = await createEventForPage(repo, page.slug, 'dyn-1');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    await confirmHold(repo, hold.id, 'guest-1', null, NOW + MIN);

    const after = await liveAvailabilityForPage(repo, page, NOW);
    expect(after.some((s) => s.start === SLOT_10.start)).toBe(false); // 予約枠は消えた
    // 予約に重なる枠（09:45-10:15 等）も出せないので総数は減る
    expect(after.length).toBeLessThan(before.length);
  });

  it('未失効の仮押さえ中の枠も live 空きから消える（保持中も二重提示しない）', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'dyn-2');
    await holdSlot(repo, event.id, SLOT_11, 'guest-1', NOW); // 確定せず保持のみ
    const live = await liveAvailabilityForPage(repo, page, NOW);
    expect(live.some((s) => s.start === SLOT_11.start)).toBe(false);
  });

  it('仮押さえがTTLで失効したら枠は live 空きに戻る', async () => {
    const page = await makePage(repo, { ...baseSettings, hold_ttl_minutes: 15 });
    const { event } = await createEventForPage(repo, page.slug, 'dyn-3');
    await holdSlot(repo, event.id, SLOT_11, 'guest-1', NOW); // expiresAt = NOW+15min
    const after = await liveAvailabilityForPage(repo, page, NOW + 16 * MIN);
    expect(after.some((s) => s.start === SLOT_11.start)).toBe(true); // 失効で復活
  });
});

describe('T2 確定型フロー', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('hold→confirm で確定し Confirmation が作られる', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'idem-1');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    const conf = await confirmHold(repo, hold.id, 'guest-1', { company: 'A社' }, NOW + MIN);

    expect(conf.start).toBe(SLOT_10.start);
    const ev = await repo.getEvent(event.id);
    expect(ev?.status).toBe('confirmed');
    const list = await repo.listConfirmations(event.id);
    expect(list).toHaveLength(1);
  });

  it('確定すると同一イベントの他の Hold は破棄される（§22 T2）', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'idem-2');
    const { hold: holdX } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    const { hold: holdY } = await holdSlot(repo, event.id, SLOT_11, 'guest-1', NOW);

    await confirmHold(repo, holdX.id, 'guest-1', null, NOW + MIN);
    // 破棄された Y を確定しようとすると EXPIRED（解放済み）
    await expectCode('EXPIRED', () => confirmHold(repo, holdY.id, 'guest-1', null, NOW + MIN));
  });
});

describe('ダブルブッキング防止（§12）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('同一リソース・同一枠の二重 active Hold は CONFLICT_HOLD で物理的に発生しない', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'idem-3');
    await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    await expectCode('CONFLICT_HOLD', () => holdSlot(repo, event.id, SLOT_10, 'guest-2', NOW));
  });

  it('重なる枠（10:00-10:30 と 10:15-10:45）も衝突する', async () => {
    const page = await makePage(repo, { ...baseSettings, duration_minutes: 30 });
    const { event } = await createEventForPage(repo, page.slug, 'idem-3b');
    await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    const overlap = { start: jst(10, 15), end: jst(10, 45) };
    await expectCode('CONFLICT_HOLD', () => holdSlot(repo, event.id, overlap, 'guest-2', NOW));
  });

  it('確定済みの枠は別イベントが再予約できない（confirmed もブロック）', async () => {
    const page = await makePage(repo);
    const { event: ev1 } = await createEventForPage(repo, page.slug, 'idem-c1');
    const { hold } = await holdSlot(repo, ev1.id, SLOT_10, 'guest-1', NOW);
    await confirmHold(repo, hold.id, 'guest-1', null, NOW + MIN);
    // 同一ページ（=同一主催者リソース）の別イベントで同じ枠を取りに行く → 物理的に不可
    const { event: ev2 } = await createEventForPage(repo, page.slug, 'idem-c2');
    await expectCode('CONFLICT_HOLD', () => holdSlot(repo, ev2.id, SLOT_10, 'guest-2', NOW + 2 * MIN));
  });

  it('TTL 失効した active Hold は枠をブロックしない（遅延解放）', async () => {
    const page = await makePage(repo, { ...baseSettings, hold_ttl_minutes: 15 });
    const { event: ev1 } = await createEventForPage(repo, page.slug, 'idem-x1');
    await holdSlot(repo, ev1.id, SLOT_10, 'guest-1', NOW); // expiresAt = NOW+15min
    // 16分後に別ユーザーが同枠を取得 → 期限切れは解放され成功する
    const { event: ev2 } = await createEventForPage(repo, page.slug, 'idem-x2');
    const { hold } = await holdSlot(repo, ev2.id, SLOT_10, 'guest-2', NOW + 16 * MIN);
    expect(hold.status).toBe('active');
  });
});

describe('冪等性（§7-6）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('同一 Idempotency-Key の createEvent は同一イベントを再利用', async () => {
    const page = await makePage(repo);
    const a = await createEventForPage(repo, page.slug, 'same-key');
    const b = await createEventForPage(repo, page.slug, 'same-key');
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(a.event.id).toBe(b.event.id);
  });

  it('確定の二重送信は二重予約を生まない（1件のみ）', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'idem-4');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    const c1 = await confirmHold(repo, hold.id, 'guest-1', null, NOW + MIN);
    const c2 = await confirmHold(repo, hold.id, 'guest-1', null, NOW + 2 * MIN);
    expect(c2.id).toBe(c1.id);
    expect(await repo.listConfirmations(event.id)).toHaveLength(1);
  });
});

describe('検証エラー（§20）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('過去枠は PAST_TIME', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'e1');
    const past = { start: NOW - 60 * MIN, end: NOW - 30 * MIN };
    await expectCode('PAST_TIME', () => holdSlot(repo, event.id, past, 'g', NOW));
  });

  it('グリッド外（7分枠）は GRID_VIOLATION', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'e2');
    const bad = { start: jst(10, 0), end: jst(10, 0) + 7 * MIN };
    await expectCode('GRID_VIOLATION', () => holdSlot(repo, event.id, bad, 'g', NOW));
  });

  it('直前予約は MIN_NOTICE', async () => {
    const page = await makePage(repo, { ...baseSettings, min_notice_minutes: 120 });
    // now を 09:00 JST に。10:00 枠は 60 分後 < 120 分 → MIN_NOTICE
    const now9 = jst(9, 0);
    const { event } = await createEventForPage(repo, page.slug, 'e3');
    await expectCode('MIN_NOTICE', () => holdSlot(repo, event.id, SLOT_10, 'g', now9));
  });

  it('受付時間外は OUT_OF_HOURS', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'e4');
    const evening = { start: jst(19, 0), end: jst(19, 30) };
    await expectCode('OUT_OF_HOURS', () => holdSlot(repo, event.id, evening, 'g', NOW));
  });

  it('TTL 超過後の確定は EXPIRED', async () => {
    const page = await makePage(repo, { ...baseSettings, hold_ttl_minutes: 15 });
    const { event } = await createEventForPage(repo, page.slug, 'e5');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'g', NOW);
    await expectCode('EXPIRED', () => confirmHold(repo, hold.id, 'g', null, NOW + 16 * MIN));
  });

  it('別人による確定は FORBIDDEN', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'e6');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    await expectCode('FORBIDDEN', () => confirmHold(repo, hold.id, 'attacker', null, NOW + MIN));
  });
});
