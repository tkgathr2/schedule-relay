import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '../../repo/memory.js';
import {
  availabilityForPage,
  liveAvailabilityForPage,
  createEventForPage,
  holdSlot,
  confirmHold,
  releaseHeldSlot,
  resolveSettings,
  createSelfHoldsForPage,
  releaseAllSelfHoldsForPage,
  listSelfHoldSlotsForPage,
  validateSlot,
  pickOneCandidatePerDay,
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

  it('Google未連携でもhold/confirmは成立する（degrade-safe・googleEventIdはnullのまま）', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'idem-3');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    expect(hold.googleEventId).toBeNull();
    const conf = await confirmHold(repo, hold.id, 'guest-1', null, NOW + MIN);
    expect(conf.start).toBe(SLOT_10.start);
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

describe('Hold の googleEventId 掃除ロジック（repo層・「[調整中]」仮予定の後始末）', () => {
  // holdSlot/confirmHold(service層)はGoogle未連携だとgoogleEventIdを紐付けないため、
  // ここではrepoを直接操作してattachHoldGoogleEventId後の解放/確定で
  // 対象のgoogleEventIdが正しく呼び出し側に返る（＝カレンダーから削除できる）ことを検証する。
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('TTL失効したHoldのgoogleEventIdが、次の同一resourceIdへのholdで掃除対象として返る', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'gc-1');
    const { hold: expired } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    await repo.attachHoldGoogleEventId(expired.id, 'gcal-evt-expired');

    // TTL(既定15分)を過ぎてから、同一resourceId(=organizerId)への別枠のholdを作る
    const { event: event2 } = await createEventForPage(repo, page.slug, 'gc-2');
    const result = await repo.createActiveHold({
      eventId: event2.id,
      candidateId: (await repo.upsertCandidate(event2.id, SLOT_11)).id,
      resourceId: page.organizerId,
      holderId: 'guest-2',
      slot: SLOT_11,
      expiresAt: NOW + 16 * MIN + 15 * MIN,
      now: NOW + 16 * MIN, // expired の expiresAt(NOW+15min) を過ぎている
    });
    expect(result.releasedExpiredGoogleEventIds).toEqual(['gcal-evt-expired']);
  });

  it('確定すると、確定Hold自身と破棄された他候補のgoogleEventIdが両方返る', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'gc-3');
    const { hold: holdX } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    const { hold: holdY } = await holdSlot(repo, event.id, SLOT_11, 'guest-1', NOW);
    await repo.attachHoldGoogleEventId(holdX.id, 'gcal-evt-x');
    await repo.attachHoldGoogleEventId(holdY.id, 'gcal-evt-y');

    const result = await repo.confirmHold(holdX.id, { participantId: 'guest-1', now: NOW + MIN });
    expect(result?.confirmedHoldGoogleEventId).toBe('gcal-evt-x');
    expect(result?.releasedGoogleEventIds).toEqual(['gcal-evt-y']);
  });
});

describe('releaseHeldSlot（相手が別の枠に選び直したときの明示解放）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('holderId一致なら解放でき、枠は再度holdできるようになる', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'rel-1');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);

    await releaseHeldSlot(repo, hold.id, 'guest-1');
    const released = await repo.getHold(hold.id);
    expect(released?.status).toBe('released');

    // 解放後は同じ枠を別人がholdできる（EXCLUDE制約に引っかからない）
    const { hold: hold2 } = await holdSlot(repo, event.id, SLOT_10, 'guest-2', NOW + MIN);
    expect(hold2.status).toBe('active');
  });

  it('holderId不一致は FORBIDDEN（他人のholdを解放させない）', async () => {
    const page = await makePage(repo);
    const { event } = await createEventForPage(repo, page.slug, 'rel-2');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    await expectCode('FORBIDDEN', () => releaseHeldSlot(repo, hold.id, 'attacker'));
  });

  it('存在しないholdIdを渡しても例外にならない（冪等・二重解放安全）', async () => {
    await expect(releaseHeldSlot(repo, 'nonexistent', 'guest-1')).resolves.toBeUndefined();
  });
});

describe('自分用の仮押さえ（社長要望：リンク発行時点で自分の候補枠を抑える）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('候補を反映すると、選んだ候補すべてに自分用の active Hold が作られる', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10, SLOT_11], NOW);
    const slots = await listSelfHoldSlotsForPage(repo, page, NOW);
    expect(slots).toHaveLength(2);
    expect(slots).toContainEqual(SLOT_10);
    expect(slots).toContainEqual(SLOT_11);
  });

  it('自分用の仮押さえがあっても、相手は同じ枠を実際に仮押さえできる（CONFLICT_HOLDにならない）', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10], NOW);

    const { event } = await createEventForPage(repo, page.slug, 'self-1');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    expect(hold.status).toBe('active');
  });

  it('相手が実際にその枠を仮押さえすると、同じ枠の自分用仮押さえは解除される（重複表示防止）', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10, SLOT_11], NOW);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toHaveLength(2);

    const { event } = await createEventForPage(repo, page.slug, 'self-2');
    await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);

    const remaining = await listSelfHoldSlotsForPage(repo, page, NOW);
    expect(remaining).toEqual([SLOT_11]); // SLOT_10 の自分用仮押さえだけ消える
  });

  it('相手が確定すると、残っていた自分用仮押さえは全部解除される', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10, SLOT_11], NOW);

    const { event } = await createEventForPage(repo, page.slug, 'self-3');
    const { hold } = await holdSlot(repo, event.id, SLOT_10, 'guest-1', NOW);
    // 確定前：SLOT_10 の自分用仮押さえは解除済み・SLOT_11 はまだ残っている
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toEqual([SLOT_11]);

    await confirmHold(repo, hold.id, 'guest-1', null, NOW + MIN);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toEqual([]);
  });

  it('ページを取消（cancel相当）すると、残っている自分用仮押さえを releaseAllSelfHoldsForPage で全部解除できる', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10, SLOT_11], NOW);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toHaveLength(2);

    await releaseAllSelfHoldsForPage(repo, page, NOW);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toEqual([]);
  });

  it('自分用仮押さえは /api/events の「未確定の調整」対象にならない（idempotencyKeyがself:で始まる）', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [SLOT_10], NOW);
    const events = await repo.listEventsByStatus(['open', 'holding', 'draft']);
    const selfEvents = events.filter((e) => e.pageId === page.id);
    expect(selfEvents.every((e) => e.idempotencyKey?.startsWith('self:'))).toBe(true);
  });

  it('候補が空なら何も作らない', async () => {
    const page = await makePage(repo);
    await createSelfHoldsForPage(repo, page, [], NOW);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toEqual([]);
  });

  it('候補数が最大件数(100)を超えても、最終安全弁として100件で打ち切る（社長指示・2026-08-13）', async () => {
    const page = await makePage(repo);
    // 1日1件ずつ、200日分（日次候補抽出の上限maxSlots=200が全部異なる日に散らばる極端ケースを模す）
    const manySlots = Array.from({ length: 200 }, (_, i) => ({
      start: jst(10, 0) + i * 24 * 60 * 60 * 1000,
      end: jst(10, 30) + i * 24 * 60 * 60 * 1000,
    }));
    await createSelfHoldsForPage(repo, page, manySlots, NOW);
    expect(await listSelfHoldSlotsForPage(repo, page, NOW)).toHaveLength(100);
  });
});

describe('固定候補モード（社長要望2026-08-13：/propose で選んだ候補そのものを相手に提示する）', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  // 実際の社長の指摘に合わせた5候補（うち8/15に3件・重なりあり）
  const CAND_1 = { start: jst(12, 0), end: jst(13, 0) }; // 8/13(木) 相当をシミュレートするため日付は基準日+αで代用
  const CAND_OVERLAP_A = { start: jst(11, 0), end: jst(12, 0) };
  const CAND_OVERLAP_B = { start: jst(11, 15), end: jst(12, 15) }; // Aと45分重複

  it('settings.candidates があれば、営業時間グリッドではなく候補リストそのものを返す', async () => {
    const page = await makePage(repo, {
      ...baseSettings,
      candidates: [CAND_1, CAND_OVERLAP_A, CAND_OVERLAP_B].map((s) => ({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
      })),
    });
    const slots = availabilityForPage(page, NOW);
    expect(slots).toHaveLength(3);
    expect(slots).toContainEqual(CAND_1);
    expect(slots).toContainEqual(CAND_OVERLAP_A);
    expect(slots).toContainEqual(CAND_OVERLAP_B); // 15分刻みグリッドに乗らない・重複時間帯でもそのまま提示される
  });

  it('候補が busy と重なっていれば availability から除外される（誰かが確定/仮押さえした枠は消える）', async () => {
    const page = await makePage(repo, {
      ...baseSettings,
      candidates: [CAND_1, CAND_OVERLAP_A].map((s) => ({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
      })),
    });
    const slots = availabilityForPage(page, NOW, [{ start: CAND_1.start, end: CAND_1.end }]);
    expect(slots).toEqual([CAND_OVERLAP_A]);
  });

  it('validateSlot は固定候補モードでグリッド整列チェックを行わず、候補リストと完全一致する枠だけ通す', () => {
    const page = { id: 'p', organizerId: 'org', type: 'T2', slug: 's', isActive: true, createdAt: NOW, settings: {
      ...baseSettings,
      candidates: [
        { start: new Date(CAND_OVERLAP_B.start).toISOString(), end: new Date(CAND_OVERLAP_B.end).toISOString() },
      ],
    } } as BookingPageRec;
    // 15分グリッドには乗っているが候補外の枠 → 通常モードなら通るが固定候補モードでは弾かれる
    expect(() => validateSlot(page, SLOT_10, NOW)).toThrow();
    // 候補そのもの（グリッド上は非整列でも良い）は通る
    expect(() => validateSlot(page, CAND_OVERLAP_B, NOW)).not.toThrow();
  });

  it('settings.candidates が無ければ従来通り営業時間グリッドの自動列挙のまま（後方互換）', () => {
    const page = { id: 'p', organizerId: 'org', type: 'T1', slug: 's', isActive: true, createdAt: NOW, settings: baseSettings } as BookingPageRec;
    const slots = availabilityForPage(page, NOW);
    expect(slots.length).toBeGreaterThan(1);
  });

  it('pickOneCandidatePerDay は同じ日(JST)のうち最も早い枠だけを残す', () => {
    const picked = pickOneCandidatePerDay([CAND_OVERLAP_B, CAND_OVERLAP_A, CAND_1]);
    // CAND_1/CAND_OVERLAP_A/CAND_OVERLAP_B は全部同じJST日付なので1件だけ残る＝最も早い開始時刻のもの
    expect(picked).toHaveLength(1);
    expect(picked[0]).toEqual(CAND_OVERLAP_A);
  });
});

describe('resolveSettings: 曜日別 working_hours の往復（回帰防止・指摘14/#16）', () => {
  // /propose の buildWorkingHoursPayload が出力する形式（mon_fri を含まず、7曜日を個別指定）を
  // そのまま resolveSettings に通して、個別曜日キーが握りつぶされず既定値(09:00-18:00)に
  // フォールバックしないことを確認する。過去に mon/tue/wed/thu/fri が未読み取りのまま
  // 既定値へ落ちる回帰があった（PR#16→本PRで修正）。
  it('平日を個別設定した working_hours がそのまま解決される（水曜だけ休みにできる）', () => {
    const payload = {
      tz: 'Asia/Tokyo',
      mon: ['13:00', '17:00'],
      tue: ['13:00', '17:00'],
      wed: [], // 水曜休み
      thu: ['13:00', '17:00'],
      fri: ['13:00', '17:00'],
      sat: [],
      sun: [],
    };
    const resolved = resolveSettings(JSON.parse(JSON.stringify({ working_hours: payload })));
    expect(resolved.workingHours.mon).toEqual(['13:00', '17:00']);
    expect(resolved.workingHours.wed).toEqual([]);
    expect(resolved.workingHours.fri).toEqual(['13:00', '17:00']);
    // mon_fri は個別指定が無いときだけのフォールバックなので既定値のままでよいが、
    // rangesForWeekday 側は mon 等の個別指定を優先するため実際の展開には影響しない。
  });

  it('土日を有効化した working_hours も解決される', () => {
    const payload = {
      tz: 'Asia/Tokyo',
      mon: ['09:00', '18:00'],
      tue: ['09:00', '18:00'],
      wed: ['09:00', '18:00'],
      thu: ['09:00', '18:00'],
      fri: ['09:00', '18:00'],
      sat: ['10:00', '15:00'],
      sun: [],
    };
    const resolved = resolveSettings(JSON.parse(JSON.stringify({ working_hours: payload })));
    expect(resolved.workingHours.sat).toEqual(['10:00', '15:00']);
  });

  it('個別曜日が未指定なら mon_fri の既定値にフォールバックする（後方互換）', () => {
    const resolved = resolveSettings({ working_hours: { tz: 'Asia/Tokyo' } });
    expect(resolved.workingHours.mon).toBeUndefined();
    expect(resolved.workingHours.mon_fri).toEqual(['09:00', '18:00']);
  });
});
