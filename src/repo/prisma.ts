/**
 * Prisma + PostgreSQL 実装の Repository。
 * DATABASE_URL が設定されている本番環境で使う。
 * in-memory 実装と同じ不変条件を PostgreSQL の EXCLUDE 制約で保証する。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  BookingPageRec,
  CandidateRec,
  ConfirmationRec,
  ConfirmHoldResult,
  ConfirmInput,
  CreateEventInput,
  CreateHoldInput,
  CreateHoldResult,
  CreatePageInput,
  CreateRelayStepInput,
  EventRec,
  EventStatus,
  HoldRec,
  RelayStepRec,
  Repository,
  VoteRec,
  VoteTally,
} from './types.js';
import { ConflictHoldError } from './types.js';
import type { Interval, RelaySubMode, Slot } from '../domain/types.js';

let _client: PrismaClient | undefined;
function getClient(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

// ---------- 変換ヘルパー ----------

function toMs(d: Date): number {
  return d.getTime();
}
function toDate(ms: number): Date {
  return new Date(ms);
}

function toPageRec(p: {
  id: string;
  organizerId: string;
  type: string;
  slug: string;
  isActive: boolean;
  settings: Prisma.JsonValue;
  createdAt: Date;
}): BookingPageRec {
  return {
    id: p.id,
    organizerId: p.organizerId,
    type: p.type as BookingPageRec['type'],
    slug: p.slug,
    isActive: p.isActive,
    settings: p.settings,
    createdAt: toMs(p.createdAt),
  };
}

function toEventRec(e: {
  id: string;
  pageId: string;
  type: string;
  status: string;
  idempotencyKey: string | null;
  createdAt: Date;
}): EventRec {
  return {
    id: e.id,
    pageId: e.pageId,
    type: e.type as EventRec['type'],
    status: e.status as EventRec['status'],
    idempotencyKey: e.idempotencyKey,
    createdAt: toMs(e.createdAt),
  };
}

function toCandidateRec(c: {
  id: string;
  eventId: string;
  startAt: Date;
  endAt: Date;
}): CandidateRec {
  return { id: c.id, eventId: c.eventId, start: toMs(c.startAt), end: toMs(c.endAt) };
}

function toHoldRec(h: {
  id: string;
  eventId: string;
  candidateId: string;
  resourceId: string;
  holderId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  googleEventId: string | null;
}): HoldRec {
  return {
    id: h.id,
    eventId: h.eventId,
    candidateId: h.candidateId,
    resourceId: h.resourceId,
    holderId: h.holderId,
    start: toMs(h.startAt),
    end: toMs(h.endAt),
    status: h.status as HoldRec['status'],
    expiresAt: toMs(h.expiresAt),
    createdAt: toMs(h.createdAt),
    googleEventId: h.googleEventId,
  };
}

function toVoteRec(v: {
  id: string;
  eventId: string;
  candidateId: string;
  voterId: string;
  createdAt: Date;
}): VoteRec {
  return {
    id: v.id,
    eventId: v.eventId,
    candidateId: v.candidateId,
    voterId: v.voterId,
    createdAt: toMs(v.createdAt),
  };
}

function toRelayStepRec(s: {
  id: string;
  eventId: string;
  order: number;
  assigneeId: string;
  subMode: string;
  status: string;
  deadline: Date | null;
  slotStart: Date | null;
  slotEnd: Date | null;
}): RelayStepRec {
  return {
    id: s.id,
    eventId: s.eventId,
    order: s.order,
    assigneeId: s.assigneeId,
    subMode: s.subMode as RelaySubMode,
    status: s.status as RelayStepRec['status'],
    deadline: s.deadline ? toMs(s.deadline) : null,
    slotStart: s.slotStart ? toMs(s.slotStart) : null,
    slotEnd: s.slotEnd ? toMs(s.slotEnd) : null,
  };
}

function toConfirmationRec(c: {
  id: string;
  eventId: string;
  participantId: string;
  startAt: Date;
  endAt: Date;
  formAnswers: Prisma.JsonValue;
  confirmedAt: Date;
}): ConfirmationRec {
  return {
    id: c.id,
    eventId: c.eventId,
    participantId: c.participantId,
    start: toMs(c.startAt),
    end: toMs(c.endAt),
    formAnswers: c.formAnswers,
    confirmedAt: toMs(c.confirmedAt),
  };
}

// ---------- Repository 実装 ----------

export class PrismaRepository implements Repository {
  private db = getClient();

  async createPage(input: CreatePageInput): Promise<BookingPageRec> {
    const p = await this.db.bookingPage.create({
      data: {
        organizerId: input.organizerId,
        type: input.type as never,
        slug: input.slug,
        isActive: input.isActive ?? true,
        settings: input.settings as Prisma.InputJsonValue,
      },
    });
    return toPageRec(p);
  }

  async getPageBySlug(slug: string): Promise<BookingPageRec | null> {
    const p = await this.db.bookingPage.findUnique({ where: { slug } });
    return p ? toPageRec(p) : null;
  }

  async getPageById(id: string): Promise<BookingPageRec | null> {
    const p = await this.db.bookingPage.findUnique({ where: { id } });
    return p ? toPageRec(p) : null;
  }

  async createEvent(
    input: CreateEventInput,
  ): Promise<{ event: EventRec; reused: boolean }> {
    if (input.idempotencyKey) {
      const existing = await this.db.event.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { event: toEventRec(existing), reused: true };
    }
    const e = await this.db.event.create({
      data: {
        pageId: input.pageId,
        type: input.type as never,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { event: toEventRec(e), reused: false };
  }

  async getEvent(id: string): Promise<EventRec | null> {
    const e = await this.db.event.findUnique({ where: { id } });
    return e ? toEventRec(e) : null;
  }

  async upsertCandidate(eventId: string, slot: Slot): Promise<CandidateRec> {
    const startAt = toDate(slot.start);
    const endAt = toDate(slot.end);
    // @@unique([eventId, startAt, endAt]) に基づく真の upsert（DBが重複を原子的に排除）。
    const c = await this.db.candidate.upsert({
      where: { eventId_startAt_endAt: { eventId, startAt, endAt } },
      create: { eventId, startAt, endAt },
      update: {},
    });
    return toCandidateRec(c);
  }

  async createActiveHold(input: CreateHoldInput): Promise<CreateHoldResult> {
    try {
      // 遅延スイープ → Hold作成 → Event status='holding' を1トランザクションで原子的に行う
      // （types.ts の「トランザクション＋EXCLUDE で原子性を保証」要件・memory版と同じ振る舞い）。
      const { created, releasedExpiredGoogleEventIds } = await this.db.$transaction(async (tx) => {
        // ① 期限切れ active を先に released へ落とす前に、掃除対象（主催者カレンダーの仮予定）を集める。
        const expired = await tx.hold.findMany({
          where: {
            resourceId: input.resourceId,
            status: 'active',
            expiresAt: { lte: toDate(input.now) },
          },
          select: { googleEventId: true },
        });
        await tx.hold.updateMany({
          where: {
            resourceId: input.resourceId,
            status: 'active',
            expiresAt: { lte: toDate(input.now) },
          },
          data: { status: 'released' },
        });

        // ② Hold作成（EXCLUDE制約で物理的に二重予約を防止）
        const created = await tx.hold.create({
          data: {
            eventId: input.eventId,
            candidateId: input.candidateId,
            resourceId: input.resourceId,
            holderId: input.holderId,
            startAt: toDate(input.slot.start),
            endAt: toDate(input.slot.end),
            status: 'active',
            expiresAt: toDate(input.expiresAt),
          },
        });

        // ③ Event を open → holding に遷移（memory.ts:130-131 と同じ）
        await tx.event.updateMany({
          where: { id: input.eventId, status: 'open' },
          data: { status: 'holding' },
        });

        return {
          created,
          releasedExpiredGoogleEventIds: expired
            .map((e) => e.googleEventId)
            .filter((id): id is string => !!id),
        };
      });
      return { hold: toHoldRec(created), releasedExpiredGoogleEventIds };
    } catch (e) {
      // EXCLUDE 制約違反だけを CONFLICT_HOLD に翻訳する（PG code 23P01 / 制約名で判定）。
      // FK 違反・接続エラー等の無関係な失敗を 409 で握り潰さない。
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('hold_no_double_booking') || msg.includes('23P01')) {
        throw new ConflictHoldError();
      }
      throw e;
    }
  }

  async getHold(id: string): Promise<HoldRec | null> {
    const h = await this.db.hold.findUnique({ where: { id } });
    return h ? toHoldRec(h) : null;
  }

  async releaseHold(id: string): Promise<void> {
    await this.db.hold.update({ where: { id }, data: { status: 'released' } });
  }

  async attachHoldGoogleEventId(holdId: string, googleEventId: string): Promise<void> {
    await this.db.hold.update({ where: { id: holdId }, data: { googleEventId } });
  }

  async confirmHold(
    holdId: string,
    input: ConfirmInput,
  ): Promise<ConfirmHoldResult | null> {
    return this.db.$transaction(async (tx) => {
      const hold = await tx.hold.findUnique({ where: { id: holdId } });
      if (!hold) return null;

      // 冪等再送：既に confirmed なら既存 Confirmation を返す
      // （memory.ts と同じく eventId・start・end・participantId で一致判定。掃除対象は既に処理済みのため空）。
      if (hold.status === 'confirmed') {
        const existing = await tx.confirmation.findFirst({
          where: {
            eventId: hold.eventId,
            participantId: input.participantId,
            startAt: hold.startAt,
            endAt: hold.endAt,
          },
        });
        return existing
          ? { confirmation: toConfirmationRec(existing), confirmedHoldGoogleEventId: null, releasedGoogleEventIds: [] }
          : null;
      }

      // active かつ未失効であること
      if (hold.status !== 'active') return null;
      if (hold.expiresAt <= toDate(input.now)) return null;

      // Hold → confirmed
      await tx.hold.update({ where: { id: holdId }, data: { status: 'confirmed' } });

      // Event → confirmed
      await tx.event.update({
        where: { id: hold.eventId },
        data: { status: 'confirmed' },
      });

      // 同一イベントの他の active Hold は解放（T2：確定で他候補は破棄・§22・memory.ts:181-185）。
      // 解放前に掃除対象（主催者カレンダーの仮予定）を集めておく。
      const released = await tx.hold.findMany({
        where: { eventId: hold.eventId, id: { not: holdId }, status: 'active' },
        select: { googleEventId: true },
      });
      await tx.hold.updateMany({
        where: { eventId: hold.eventId, id: { not: holdId }, status: 'active' },
        data: { status: 'released' },
      });

      // Confirmation 作成
      const conf = await tx.confirmation.create({
        data: {
          eventId: hold.eventId,
          participantId: input.participantId,
          startAt: hold.startAt,
          endAt: hold.endAt,
          formAnswers: (input.formAnswers as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      return {
        confirmation: toConfirmationRec(conf),
        confirmedHoldGoogleEventId: hold.googleEventId,
        releasedGoogleEventIds: released.map((r) => r.googleEventId).filter((id): id is string => !!id),
      };
    });
  }

  async listConfirmations(eventId: string): Promise<ConfirmationRec[]> {
    const rows = await this.db.confirmation.findMany({
      where: { eventId },
      orderBy: { confirmedAt: 'asc' },
    });
    return rows.map(toConfirmationRec);
  }

  async listPagesByOrganizer(organizerId: string): Promise<BookingPageRec[]> {
    const rows = await this.db.bookingPage.findMany({
      where: { organizerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPageRec);
  }

  async listEventsByStatus(statuses: EventStatus[]): Promise<EventRec[]> {
    const rows = await this.db.event.findMany({
      where: { status: { in: statuses as never } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toEventRec);
  }

  async listConfirmationsFiltered(filter?: {
    organizerId?: string;
    fromMs?: number;
  }): Promise<ConfirmationRec[]> {
    const where: Prisma.ConfirmationWhereInput = {};
    if (filter?.fromMs !== undefined) {
      where.startAt = { gte: toDate(filter.fromMs) };
    }
    if (filter?.organizerId) {
      where.event = { is: { page: { is: { organizerId: filter.organizerId } } } };
    }
    const rows = await this.db.confirmation.findMany({
      where,
      orderBy: { startAt: 'desc' },
    });
    return rows.map(toConfirmationRec);
  }

  async deactivatePageBySlug(slug: string): Promise<BookingPageRec | null> {
    const existing = await this.db.bookingPage.findUnique({ where: { slug } });
    if (!existing) return null;
    const updated = await this.db.bookingPage.update({
      where: { slug },
      data: { isActive: false },
    });
    return toPageRec(updated);
  }

  async setPageActiveBySlug(slug: string, isActive: boolean): Promise<BookingPageRec | null> {
    const existing = await this.db.bookingPage.findUnique({ where: { slug } });
    if (!existing) return null;
    const updated = await this.db.bookingPage.update({
      where: { slug },
      data: { isActive },
    });
    return toPageRec(updated);
  }

  async updatePageSettingsBySlug(slug: string, settings: unknown): Promise<BookingPageRec | null> {
    const existing = await this.db.bookingPage.findUnique({ where: { slug } });
    if (!existing) return null;
    const updated = await this.db.bookingPage.update({
      where: { slug },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return toPageRec(updated);
  }

  async listAllPages(): Promise<BookingPageRec[]> {
    const rows = await this.db.bookingPage.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPageRec);
  }

  async countConfirmationsByPage(): Promise<Map<string, number>> {
    const rows = await this.db.confirmation.findMany({
      include: { event: { select: { pageId: true } } },
    });
    const result = new Map<string, number>();
    for (const c of rows) {
      const pageId = c.event?.pageId;
      if (!pageId) continue;
      result.set(pageId, (result.get(pageId) ?? 0) + 1);
    }
    return result;
  }

  async listBlockingIntervals(resourceId: string, now: number): Promise<Interval[]> {
    // 確定済み（confirmed の Hold）＋ 未失効 active → busy として返す
    const rows = await this.db.hold.findMany({
      where: {
        resourceId,
        OR: [
          { status: 'confirmed' },
          { status: 'active', expiresAt: { gt: toDate(now) } },
        ],
      },
    });
    return rows.map((h) => ({ start: toMs(h.startAt), end: toMs(h.endAt) }));
  }

  async listActiveHoldsByEvent(eventId: string, now: number): Promise<HoldRec[]> {
    const rows = await this.db.hold.findMany({
      where: { eventId, status: 'active', expiresAt: { gt: toDate(now) } },
    });
    return rows.map(toHoldRec);
  }

  // ---------- T3 投票型 ----------
  async addCandidate(eventId: string, slot: Slot): Promise<CandidateRec> {
    return this.upsertCandidate(eventId, slot);
  }

  async listCandidates(eventId: string): Promise<CandidateRec[]> {
    const rows = await this.db.candidate.findMany({
      where: { eventId },
      orderBy: { startAt: 'asc' },
    });
    return rows.map(toCandidateRec);
  }

  async castVote(eventId: string, candidateId: string, voterId: string): Promise<VoteRec> {
    const v = await this.db.vote.upsert({
      where: {
        eventId_candidateId_voterId: { eventId, candidateId, voterId },
      },
      create: { eventId, candidateId, voterId },
      update: {},
    });
    return toVoteRec(v);
  }

  async tallyVotes(eventId: string): Promise<VoteTally[]> {
    const cands = await this.listCandidates(eventId);
    const grouped = await this.db.vote.groupBy({
      by: ['candidateId'],
      where: { eventId },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) map.set(g.candidateId, g._count._all);
    return cands.map((c) => ({ candidate: c, count: map.get(c.id) ?? 0 }));
  }

  // ---------- T6 リレー型 ----------
  async createRelaySteps(
    eventId: string,
    steps: CreateRelayStepInput[],
  ): Promise<RelayStepRec[]> {
    if (steps.length === 0) throw new Error('relay requires at least one step');
    const existing = await this.db.relayStep.count({ where: { eventId } });
    if (existing > 0) throw new Error('relay steps already exist for this event');
    const orders = new Set<number>();
    for (const s of steps) {
      if (orders.has(s.order)) throw new Error(`duplicate order: ${s.order}`);
      orders.add(s.order);
    }
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    await this.db.$transaction(async (tx) => {
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]!;
        await tx.relayStep.create({
          data: {
            eventId,
            order: s.order,
            assigneeId: s.assigneeId,
            subMode: s.subMode as never,
            status: (i === 0 ? 'active' : 'waiting') as never,
            deadline: s.deadline ? toDate(s.deadline) : null,
          },
        });
      }
    });
    return this.getRelaySteps(eventId);
  }

  async getRelaySteps(eventId: string): Promise<RelayStepRec[]> {
    const rows = await this.db.relayStep.findMany({
      where: { eventId },
      orderBy: { order: 'asc' },
    });
    return rows.map(toRelayStepRec);
  }

  async advanceRelay(
    eventId: string,
    stepId: string,
    confirmedSlot: Slot,
  ): Promise<RelayStepRec[] | null> {
    return this.db.$transaction(async (tx) => {
      const steps = await tx.relayStep.findMany({
        where: { eventId },
        orderBy: { order: 'asc' },
      });
      if (steps.length === 0) return null;
      const activeIdx = steps.findIndex((s) => s.status === 'active');
      if (activeIdx === -1) return null;
      const active = steps[activeIdx]!;
      if (active.id !== stepId) return null;

      await tx.relayStep.update({
        where: { id: active.id },
        data: {
          status: 'done' as never,
          slotStart: toDate(confirmedSlot.start),
          slotEnd: toDate(confirmedSlot.end),
        },
      });

      const nextIdx = steps.findIndex((s, i) => i > activeIdx && s.status === 'waiting');
      if (nextIdx !== -1) {
        await tx.relayStep.update({
          where: { id: steps[nextIdx]!.id },
          data: { status: 'active' as never },
        });
      }

      const after = await tx.relayStep.findMany({
        where: { eventId },
        orderBy: { order: 'asc' },
      });
      return after.map(toRelayStepRec);
    });
  }

  async rollbackRelay(eventId: string, stepId: string): Promise<RelayStepRec[] | null> {
    return this.db.$transaction(async (tx) => {
      const steps = await tx.relayStep.findMany({
        where: { eventId },
        orderBy: { order: 'asc' },
      });
      const targetIdx = steps.findIndex((s) => s.id === stepId);
      if (targetIdx === -1) return null;
      const target = steps[targetIdx]!;
      if (target.status !== 'done') return null;

      for (let i = targetIdx; i < steps.length; i++) {
        const s = steps[i]!;
        await tx.relayStep.update({
          where: { id: s.id },
          data: {
            status: (i === targetIdx ? 'active' : 'waiting') as never,
            slotStart: null,
            slotEnd: null,
          },
        });
      }

      const after = await tx.relayStep.findMany({
        where: { eventId },
        orderBy: { order: 'asc' },
      });
      return after.map(toRelayStepRec);
    });
  }
}

let _repo: PrismaRepository | undefined;
export function getPrismaRepository(): PrismaRepository {
  if (!_repo) _repo = new PrismaRepository();
  return _repo;
}
