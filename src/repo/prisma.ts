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
  ConfirmInput,
  CreateEventInput,
  CreateHoldInput,
  CreatePageInput,
  EventRec,
  HoldRec,
  Repository,
} from './types.js';
import { ConflictHoldError } from './types.js';
import type { Interval, Slot } from '../domain/types.js';

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

  async createActiveHold(input: CreateHoldInput): Promise<HoldRec> {
    try {
      // 遅延スイープ → Hold作成 → Event status='holding' を1トランザクションで原子的に行う
      // （types.ts の「トランザクション＋EXCLUDE で原子性を保証」要件・memory版と同じ振る舞い）。
      const h = await this.db.$transaction(async (tx) => {
        // ① 期限切れ active を先に released へ落とす（遅延スイープ・期限切れが枠を永久ブロックしない）
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

        return created;
      });
      return toHoldRec(h);
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

  async confirmHold(
    holdId: string,
    input: ConfirmInput,
  ): Promise<ConfirmationRec | null> {
    return this.db.$transaction(async (tx) => {
      const hold = await tx.hold.findUnique({ where: { id: holdId } });
      if (!hold) return null;

      // 冪等再送：既に confirmed なら既存 Confirmation を返す
      // （memory.ts と同じく eventId・start・end・participantId で一致判定）。
      if (hold.status === 'confirmed') {
        const existing = await tx.confirmation.findFirst({
          where: {
            eventId: hold.eventId,
            participantId: input.participantId,
            startAt: hold.startAt,
            endAt: hold.endAt,
          },
        });
        return existing ? toConfirmationRec(existing) : null;
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
      return toConfirmationRec(conf);
    });
  }

  async listConfirmations(eventId: string): Promise<ConfirmationRec[]> {
    const rows = await this.db.confirmation.findMany({
      where: { eventId },
      orderBy: { confirmedAt: 'asc' },
    });
    return rows.map(toConfirmationRec);
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
}

let _repo: PrismaRepository | undefined;
export function getPrismaRepository(): PrismaRepository {
  if (!_repo) _repo = new PrismaRepository();
  return _repo;
}
