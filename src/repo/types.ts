/**
 * 永続化リポジトリのインターフェース（仕様 §8）。
 * サービス層はこの抽象だけに依存する。実装は in-memory（テスト/プレビュー）と
 * 将来の Prisma+PostgreSQL（本番）を差し替え可能にする。
 *
 * ダブルブッキング物理防止（仕様 §12）：
 *  - 本番＝PostgreSQL の EXCLUDE 制約（migration.sql）。
 *  - in-memory＝createActiveHold 内で「同一 resourceId・active・半開区間が重なる」Hold を検出し
 *    ConflictHoldError を投げることで同じ不変条件を保証する。
 */
import type { AdjustmentType, EpochMs, Interval, Slot } from '../domain/types.js';

export interface BookingPageRec {
  id: string;
  organizerId: string;
  type: AdjustmentType;
  slug: string;
  isActive: boolean;
  settings: unknown;
  createdAt: EpochMs;
}

export type EventStatus =
  | 'draft'
  | 'open'
  | 'holding'
  | 'confirmed'
  | 'closed'
  | 'expired'
  | 'cancelled';

export interface EventRec {
  id: string;
  pageId: string;
  type: AdjustmentType;
  status: EventStatus;
  idempotencyKey: string | null;
  createdAt: EpochMs;
}

export interface CandidateRec {
  id: string;
  eventId: string;
  start: EpochMs;
  end: EpochMs;
}

export type HoldStatus = 'active' | 'released' | 'confirmed';

export interface HoldRec {
  id: string;
  eventId: string;
  candidateId: string;
  resourceId: string;
  holderId: string;
  start: EpochMs;
  end: EpochMs;
  status: HoldStatus;
  expiresAt: EpochMs;
  createdAt: EpochMs;
}

export interface ConfirmationRec {
  id: string;
  eventId: string;
  participantId: string;
  start: EpochMs;
  end: EpochMs;
  formAnswers: unknown;
  confirmedAt: EpochMs;
}

/** createActiveHold が衝突したときに投げる型（サービス層が CONFLICT_HOLD に翻訳）。 */
export class ConflictHoldError extends Error {
  constructor(message = 'overlapping active hold exists for resource') {
    super(message);
    this.name = 'ConflictHoldError';
  }
}

export interface CreatePageInput {
  organizerId: string;
  type: AdjustmentType;
  slug: string;
  settings: unknown;
  isActive?: boolean;
}

export interface CreateEventInput {
  pageId: string;
  type: AdjustmentType;
  idempotencyKey: string | null;
}

export interface CreateHoldInput {
  eventId: string;
  candidateId: string;
  resourceId: string;
  holderId: string;
  slot: Slot;
  expiresAt: EpochMs;
  /** 現在時刻（UTC ms）。期限切れ active の判定・遅延スイープに使う。 */
  now: EpochMs;
}

export interface ConfirmInput {
  participantId: string;
  formAnswers?: unknown;
  now: EpochMs;
}

/**
 * リポジトリ契約。実装は原子性を保証すること。
 * （in-memory は単一スレッドで原子的。Prisma 実装はトランザクション＋EXCLUDE で保証する。）
 */
export interface Repository {
  createPage(input: CreatePageInput): Promise<BookingPageRec>;
  getPageBySlug(slug: string): Promise<BookingPageRec | null>;
  getPageById(id: string): Promise<BookingPageRec | null>;

  /** idempotencyKey が既存ならその Event を返し、無ければ作成する（冪等・§7-6）。 */
  createEvent(input: CreateEventInput): Promise<{ event: EventRec; reused: boolean }>;
  getEvent(id: string): Promise<EventRec | null>;

  /** 候補枠を作成（無ければ作る）。同一 (eventId, slot) は再利用。 */
  upsertCandidate(eventId: string, slot: Slot): Promise<CandidateRec>;

  /**
   * active な Hold を作成する。
   * 同一 resourceId に半開区間が重なる active Hold が既にあれば ConflictHoldError を投げる
   * （= EXCLUDE 制約と同じ物理防止）。
   */
  createActiveHold(input: CreateHoldInput): Promise<HoldRec>;
  getHold(id: string): Promise<HoldRec | null>;
  releaseHold(id: string): Promise<void>;

  /**
   * Hold を確定する（原子的）。
   *  - Hold が active かつ未失効（expiresAt > now）であること。失効なら null を返す。
   *  - holderId と confirm の participantId 不一致は呼び出し側で検証済み前提。
   *  - 成功時：Hold→confirmed、Event→confirmed、Confirmation を作成して返す。
   *  - 既に confirmed の Hold を再確定（冪等再送）した場合は既存の Confirmation を返す。
   */
  confirmHold(holdId: string, input: ConfirmInput): Promise<ConfirmationRec | null>;

  /** デバッグ/テスト用：イベントの確定一覧。 */
  listConfirmations(eventId: string): Promise<ConfirmationRec[]>;

  /**
   * 指定リソース（主催者枠）で「いま枠を塞いでいる」区間を返す。
   * ＝確定済み（confirmed）＋未失効の active 仮押さえ（EXCLUDE 制約と同じ述語）。
   * 動的な空き算出で busy として差し引くことで、取られた枠が即座に空きから消える。
   */
  listBlockingIntervals(resourceId: string, now: EpochMs): Promise<Interval[]>;
}
