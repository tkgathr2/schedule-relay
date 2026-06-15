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
import type { Slot } from '../domain/types.js';

export class MemoryRepository implements Repository {
  private pages = new Map<string, BookingPageRec>();
  private pagesBySlug = new Map<string, string>();
  private events = new Map<string, EventRec>();
  private eventsByIdem = new Map<string, string>();
  private candidates = new Map<string, CandidateRec>();
  private holds = new Map<string, HoldRec>();
  private confirmations = new Map<string, ConfirmationRec>();
  private votes = new Map<string, VoteRec>();
  private relaySteps = new Map<string, RelayStepRec>();
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

  async listPagesByOrganizer(organizerId: string): Promise<BookingPageRec[]> {
    return [...this.pages.values()]
      .filter((p) => p.organizerId === organizerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async listEventsByStatus(statuses: EventStatus[]): Promise<EventRec[]> {
    const set = new Set(statuses);
    return [...this.events.values()]
      .filter((e) => set.has(e.status))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async listConfirmationsFiltered(filter?: {
    organizerId?: string;
    fromMs?: number;
  }): Promise<ConfirmationRec[]> {
    let confs = [...this.confirmations.values()];
    if (filter?.fromMs !== undefined) {
      const from = filter.fromMs;
      confs = confs.filter((c) => c.start >= from);
    }
    if (filter?.organizerId) {
      const orgId = filter.organizerId;
      confs = confs.filter((c) => {
        const ev = this.events.get(c.eventId);
        if (!ev) return false;
        const page = this.pages.get(ev.pageId);
        return page ? page.organizerId === orgId : false;
      });
    }
    return confs.sort((a, b) => b.start - a.start);
  }

  async deactivatePageBySlug(slug: string): Promise<BookingPageRec | null> {
    const id = this.pagesBySlug.get(slug);
    if (!id) return null;
    const page = this.pages.get(id);
    if (!page) return null;
    page.isActive = false;
    return page;
  }

  async listBlockingIntervals(resourceId: string, now: number): Promise<{ start: number; end: number }[]> {
    const out: { start: number; end: number }[] = [];
    for (const h of this.holds.values()) {
      const blocks =
        h.resourceId === resourceId &&
        (h.status === 'confirmed' || (h.status === 'active' && h.expiresAt > now));
      if (blocks) out.push({ start: h.start, end: h.end });
    }
    return out;
  }

  // ---------- T3 投票型 ----------
  async addCandidate(eventId: string, slot: Slot): Promise<CandidateRec> {
    // 同一 (eventId, slot) は upsertCandidate と同じく再利用＝重複候補を作らない。
    return this.upsertCandidate(eventId, slot);
  }

  async listCandidates(eventId: string): Promise<CandidateRec[]> {
    return [...this.candidates.values()]
      .filter((c) => c.eventId === eventId)
      .sort((a, b) => a.start - b.start);
  }

  async castVote(eventId: string, candidateId: string, voterId: string): Promise<VoteRec> {
    // 二重投票防止：(eventId, candidateId, voterId) で一意。既存があれば再利用。
    for (const v of this.votes.values()) {
      if (v.eventId === eventId && v.candidateId === candidateId && v.voterId === voterId) {
        return v;
      }
    }
    const rec: VoteRec = {
      id: this.id('vote'),
      eventId,
      candidateId,
      voterId,
      createdAt: this.now(),
    };
    this.votes.set(rec.id, rec);
    return rec;
  }

  async tallyVotes(eventId: string): Promise<VoteTally[]> {
    const cands = await this.listCandidates(eventId);
    const counts = new Map<string, number>();
    for (const v of this.votes.values()) {
      if (v.eventId !== eventId) continue;
      counts.set(v.candidateId, (counts.get(v.candidateId) ?? 0) + 1);
    }
    return cands.map((c) => ({ candidate: c, count: counts.get(c.id) ?? 0 }));
  }

  // ---------- T6 リレー型 ----------
  async createRelaySteps(
    eventId: string,
    steps: CreateRelayStepInput[],
  ): Promise<RelayStepRec[]> {
    for (const s of this.relaySteps.values()) {
      if (s.eventId === eventId) {
        throw new Error('relay steps already exist for this event');
      }
    }
    if (steps.length === 0) throw new Error('relay requires at least one step');
    const orders = new Set<number>();
    for (const s of steps) {
      if (orders.has(s.order)) throw new Error(`duplicate order: ${s.order}`);
      orders.add(s.order);
    }
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    const created: RelayStepRec[] = sorted.map((s, idx) => ({
      id: this.id('rstep'),
      eventId,
      order: s.order,
      assigneeId: s.assigneeId,
      subMode: s.subMode,
      status: idx === 0 ? 'active' : 'waiting',
      deadline: s.deadline ?? null,
      slotStart: null,
      slotEnd: null,
    }));
    for (const r of created) this.relaySteps.set(r.id, r);
    return created;
  }

  async getRelaySteps(eventId: string): Promise<RelayStepRec[]> {
    return [...this.relaySteps.values()]
      .filter((s) => s.eventId === eventId)
      .sort((a, b) => a.order - b.order);
  }

  async advanceRelay(
    eventId: string,
    stepId: string,
    confirmedSlot: Slot,
  ): Promise<RelayStepRec[] | null> {
    const steps = await this.getRelaySteps(eventId);
    if (steps.length === 0) return null;
    const activeIdx = steps.findIndex((s) => s.status === 'active');
    if (activeIdx === -1) return null;
    const active = steps[activeIdx]!;
    if (active.id !== stepId) return null;

    const doneRec = this.relaySteps.get(active.id);
    if (!doneRec) return null;
    doneRec.status = 'done';
    doneRec.slotStart = confirmedSlot.start;
    doneRec.slotEnd = confirmedSlot.end;

    const nextIdx = steps.findIndex((s, i) => i > activeIdx && s.status === 'waiting');
    if (nextIdx !== -1) {
      const next = this.relaySteps.get(steps[nextIdx]!.id);
      if (next) next.status = 'active';
    }
    return this.getRelaySteps(eventId);
  }

  async rollbackRelay(eventId: string, stepId: string): Promise<RelayStepRec[] | null> {
    const steps = await this.getRelaySteps(eventId);
    if (steps.length === 0) return null;
    const targetIdx = steps.findIndex((s) => s.id === stepId);
    if (targetIdx === -1) return null;
    const target = steps[targetIdx]!;
    if (target.status !== 'done') return null;

    for (let i = targetIdx; i < steps.length; i++) {
      const rec = this.relaySteps.get(steps[i]!.id);
      if (!rec) continue;
      if (i === targetIdx) {
        rec.status = 'active';
        rec.slotStart = null;
        rec.slotEnd = null;
      } else {
        rec.status = 'waiting';
        rec.slotStart = null;
        rec.slotEnd = null;
      }
    }
    return this.getRelaySteps(eventId);
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
