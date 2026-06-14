/**
 * In-memory リポジトリ実装（テスト/プレビュー用）。
 * 本番は Prisma+PostgreSQL（EXCLUDE 制約）に差し替える。
 *
 * 単一スレッドの JS イベントループ内で各メソッドが同期的に状態を更新するため、
 * Hold 作成〜確定は原子的に振る舞う（仕様 §12 のフローを満たす）。
 */
import { overlaps } from '../domain/grid.js';
import type {
  BookingPageRec,
  CandidateRec,
  ConfirmInput,
  ConfirmationRec,
  CreateEventInput,
  CreateHoldInput,
  CreatePageInput,
  EventRec,
  HoldRec,
  Repository,
} from './types.js';
import { ConflictHoldError } from './types.js';

export class MemoryRepository implements Repository {
  private pages = new Map<string, BookingPageRec>();
  private pagesBySlug = new Map<string, string>();
  private events = new Map<string, EventRec>();
  private eventsByIdem = new Map<string, string>();
  private candidates = new Map<string, CandidateRec>();
  private holds = new Map<string, HoldRec>();
  private confirmations = new Map<string, ConfirmationRec>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}`;
  }

  async createPage(input: CreatePageInput): Promise<BookingPageRec> {
    if (this.pagesBySlug.has(input.slug)) {
      throw new Error(`slug already exists: ${input.slug}`);
    }
    const rec: BookingPageRec = {
      id: this.id('page'),
      organizerId: input.organizerId,
      type: input.type,
      slug: input.slug,
      isActive: input.isActive ?? true,
      settings: input.settings,
      createdAt: this.now(),
    };
    this.pages.set(rec.id, rec);
    this.pagesBySlug.set(rec.slug, rec.id);
    return rec;
  }

  async getPageBySlug(slug: string): Promise<BookingPageRec | null> {
    const id = this.pagesBySlug.get(slug);
    return id ? (this.pages.get(id) ?? null) : null;
  }

  async getPageById(id: string): Promise<BookingPageRec | null> {
    return this.pages.get(id) ?? null;
  }

  async createEvent(input: CreateEventInput): Promise<{ event: EventRec; reused: boolean }> {
    if (input.idempotencyKey) {
      const existingId = this.eventsByIdem.get(input.idempotencyKey);
      if (existingId) {
        const ev = this.events.get(existingId)!;
        return { event: ev, reused: true };
      }
    }
    const rec: EventRec = {
      id: this.id('ev'),
      pageId: input.pageId,
      type: input.type,
      status: 'open',
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
    };
    this.events.set(rec.id, rec);
    if (input.idempotencyKey) this.eventsByIdem.set(input.idempotencyKey, rec.id);
    return { event: rec, reused: false };
  }

  async getEvent(id: string): Promise<EventRec | null> {
    return this.events.get(id) ?? null;
  }

  async upsertCandidate(eventId: string, slot: { start: number; end: number }): Promise<CandidateRec> {
    for (const c of this.candidates.values()) {
      if (c.eventId === eventId && c.start === slot.start && c.end === slot.end) return c;
    }
    const rec: CandidateRec = { id: this.id('cand'), eventId, start: slot.start, end: slot.end };
    this.candidates.set(rec.id, rec);
    return rec;
  }

  async createActiveHold(input: CreateHoldInput): Promise<HoldRec> {
    // ① 遅延スイープ：TTL 失効した active を released へ落とす（期限切れが枠を永久ブロックしない）。
    for (const h of this.holds.values()) {
      if (h.status === 'active' && h.expiresAt <= input.now) h.status = 'released';
    }
    // ② EXCLUDE 制約の再現（migration.sql と同一述語）：
    //    同一 resourceId で「未失効の active」または「confirmed（実予約）」が半開区間で重なれば衝突。
    for (const h of this.holds.values()) {
      const blocks =
        (h.status === 'active' && h.expiresAt > input.now) || h.status === 'confirmed';
      if (
        blocks &&
        h.resourceId === input.resourceId &&
        overlaps({ start: h.start, end: h.end }, input.slot)
      ) {
        throw new ConflictHoldError();
      }
    }
    const rec: HoldRec = {
      id: this.id('hold'),
      eventId: input.eventId,
      candidateId: input.candidateId,
      resourceId: input.resourceId,
      holderId: input.holderId,
      start: input.slot.start,
      end: input.slot.end,
      status: 'active',
      expiresAt: input.expiresAt,
      createdAt: this.now(),
    };
    this.holds.set(rec.id, rec);
    const ev = this.events.get(input.eventId);
    if (ev && ev.status === 'open') ev.status = 'holding';
    return rec;
  }

  async getHold(id: string): Promise<HoldRec | null> {
    return this.holds.get(id) ?? null;
  }

  async releaseHold(id: string): Promise<void> {
    const h = this.holds.get(id);
    if (h && h.status === 'active') h.status = 'released';
  }

  async confirmHold(holdId: string, input: ConfirmInput): Promise<ConfirmationRec | null> {
    const hold = this.holds.get(holdId);
    if (!hold) return null;

    // 冪等再送：既に confirmed なら既存の Confirmation を返す。
    if (hold.status === 'confirmed') {
      for (const c of this.confirmations.values()) {
        if (
          c.eventId === hold.eventId &&
          c.start === hold.start &&
          c.end === hold.end &&
          c.participantId === input.participantId
        ) {
          return c;
        }
      }
      return null;
    }

    if (hold.status !== 'active') return null; // released 等
    if (hold.expiresAt <= input.now) return null; // 失効 → サービス層が EXPIRED に翻訳

    hold.status = 'confirmed';
    const conf: ConfirmationRec = {
      id: this.id('conf'),
      eventId: hold.eventId,
      participantId: input.participantId,
      start: hold.start,
      end: hold.end,
      formAnswers: input.formAnswers ?? null,
      confirmedAt: input.now,
    };
    this.confirmations.set(conf.id, conf);

    const ev = this.events.get(hold.eventId);
    if (ev) ev.status = 'confirmed';
    // 同一イベントの他の active Hold は解放（T2：確定で他候補は破棄・§22）。
    for (const h of this.holds.values()) {
      if (h.eventId === hold.eventId && h.id !== hold.id && h.status === 'active') {
        h.status = 'released';
      }
    }
    return conf;
  }

  async listConfirmations(eventId: string): Promise<ConfirmationRec[]> {
    return [...this.confirmations.values()].filter((c) => c.eventId === eventId);
  }

  // createdAt 用の時刻。確定/失効の判定は呼び出し側が渡す now を使うため、ここは記録専用。
  private now(): number {
    return Date.now();
  }
}

/** プロセス内シングルトン（プレビュー API 用。サーバ再起動で揮発）。 */
let singleton: MemoryRepository | null = null;
export function getMemoryRepository(): MemoryRepository {
  if (!singleton) singleton = new MemoryRepository();
  return singleton;
}
