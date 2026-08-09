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
import type { AdjustmentType, EpochMs, Interval, RelaySubMode, Slot } from '../domain/types.js';

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
  /** 仮押さえ中に主催者カレンダーへ作成した「[調整中]」予定のイベントID。未連携/未作成ならnull。 */
  googleEventId: string | null;
}

/** createActiveHold の戻り値。遅延スイープで一緒に解放された期限切れHoldのGoogleイベントIDも返す（掃除用）。 */
export interface CreateHoldResult {
  hold: HoldRec;
  /** 同一resourceIdで期限切れのため released になった他Holdの googleEventId（掃除対象）。 */
  releasedExpiredGoogleEventIds: string[];
}

/** confirmHold の戻り値。確定Hold自身・破棄された他候補Holdの googleEventId を掃除用に返す。 */
export interface ConfirmHoldResult {
  confirmation: ConfirmationRec;
  /** 確定した Hold 自身の googleEventId（正式予定作成後に削除する）。 */
  confirmedHoldGoogleEventId: string | null;
  /** 確定により破棄された他 active Hold の googleEventId（掃除対象）。 */
  releasedGoogleEventIds: string[];
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
  createActiveHold(input: CreateHoldInput): Promise<CreateHoldResult>;
  getHold(id: string): Promise<HoldRec | null>;
  releaseHold(id: string): Promise<void>;
  /** Hold に主催者カレンダー上の仮予定イベントIDを紐付ける（Google作成成功後に呼ぶ）。 */
  attachHoldGoogleEventId(holdId: string, googleEventId: string): Promise<void>;

  /**
   * Hold を確定する（原子的）。
   *  - Hold が active かつ未失効（expiresAt > now）であること。失効なら null を返す。
   *  - holderId と confirm の participantId 不一致は呼び出し側で検証済み前提。
   *  - 成功時：Hold→confirmed、Event→confirmed、Confirmation を作成して返す。
   *  - 既に confirmed の Hold を再確定（冪等再送）した場合は既存の Confirmation を返す（掃除用IDはnull/空）。
   */
  confirmHold(holdId: string, input: ConfirmInput): Promise<ConfirmHoldResult | null>;

  /** デバッグ/テスト用：イベントの確定一覧。 */
  listConfirmations(eventId: string): Promise<ConfirmationRec[]>;

  // ---------- 一覧系（ダッシュボード用） ----------
  /** 指定 organizer の予約ページ一覧（createdAt 降順）。 */
  listPagesByOrganizer(organizerId: string): Promise<BookingPageRec[]>;
  /** 指定ステータスのイベント一覧（createdAt 降順）。 */
  listEventsByStatus(statuses: EventStatus[]): Promise<EventRec[]>;
  /**
   * Confirmation の横断一覧。
   * filter.organizerId 指定時は BookingPage.organizerId で絞り込み（Event→Page で join）。
   * filter.fromMs 指定時は start >= fromMs のみ。
   * 並び順は start 降順。
   */
  listConfirmationsFiltered(filter?: {
    organizerId?: string;
    fromMs?: EpochMs;
  }): Promise<ConfirmationRec[]>;
  /** ページを非アクティブにする（slug 指定）。存在しなければ null。 */
  deactivatePageBySlug(slug: string): Promise<BookingPageRec | null>;
  /** ページの isActive を任意の値に更新する（admin用・active/disabled トグル）。存在しなければ null。 */
  setPageActiveBySlug(slug: string, isActive: boolean): Promise<BookingPageRec | null>;
  /** 全主催者のページを返す（admin一覧用・createdAt 降順）。 */
  listAllPages(): Promise<BookingPageRec[]>;
  /** ページ単位の確定件数を返す（admin一覧用・pageId→件数）。 */
  countConfirmationsByPage(): Promise<Map<string, number>>;

  /**
   * 指定リソース（主催者枠）で「いま枠を塞いでいる」区間を返す。
   * ＝確定済み（confirmed）＋未失効の active 仮押さえ（EXCLUDE 制約と同じ述語）。
   * 動的な空き算出で busy として差し引くことで、取られた枠が即座に空きから消える。
   */
  listBlockingIntervals(resourceId: string, now: EpochMs): Promise<Interval[]>;

  // ---------- T3 投票型 ----------
  /**
   * 投票用候補を追加（無ければ作る）。同一 (eventId, slot) は再利用＝upsertCandidate と同じ正規化。
   * T3 投票では「投票対象として明示的に並べる」用途で使う（upsertCandidate と同一実装でよい）。
   */
  addCandidate(eventId: string, slot: Slot): Promise<CandidateRec>;
  /** イベントの候補一覧（start 昇順）。 */
  listCandidates(eventId: string): Promise<CandidateRec[]>;
  /**
   * 投票を記録する（一意：同一 (eventId, candidateId, voterId) は1件）。
   * 既存があれば no-op（重複投票は無視）。
   */
  castVote(eventId: string, candidateId: string, voterId: string): Promise<VoteRec>;
  /** 候補別の集計（得票数）。投票無し候補は count=0 で返す。 */
  tallyVotes(eventId: string): Promise<VoteTally[]>;

  // ---------- T6 リレー型 ----------
  /**
   * リレーのステップ列を一括作成（既存があれば置換せず例外）。order は 0 始まり。
   * subMode はステップ単位で異なってもよい（仕様の柔軟性のため）が、運用は同一を想定。
   */
  createRelaySteps(eventId: string, steps: CreateRelayStepInput[]): Promise<RelayStepRec[]>;
  /** イベントのステップ列（order 昇順）。 */
  getRelaySteps(eventId: string): Promise<RelayStepRec[]>;
  /**
   * 現在 active のステップを done にして slot を記録し、次の waiting を active に進める。
   * 引数 stepId が現在 active と一致しなければ何もせず null を返す（楽観ロック相当）。
   */
  advanceRelay(eventId: string, stepId: string, confirmedSlot: Slot): Promise<RelayStepRec[] | null>;
  /**
   * 指定ステップを done → active に戻し、それ以降の done/active を waiting に戻す（差し戻し）。
   * 監査用に audit ログを残せる場所だが、最小実装ではステップ状態のみ更新。
   */
  rollbackRelay(eventId: string, stepId: string): Promise<RelayStepRec[] | null>;
}

// ---------- T3 投票型 型 ----------

export interface VoteRec {
  id: string;
  eventId: string;
  candidateId: string;
  voterId: string;
  createdAt: EpochMs;
}

/** 候補別の集計結果（タイブレーク前の生データ）。 */
export interface VoteTally {
  candidate: CandidateRec;
  count: number;
}

// ---------- T6 リレー型 型 ----------

export type RelayStepStatus = 'waiting' | 'active' | 'done' | 'skipped';

export interface RelayStepRec {
  id: string;
  eventId: string;
  order: number;
  assigneeId: string;
  subMode: RelaySubMode;
  status: RelayStepStatus;
  deadline: EpochMs | null;
  /** done の時に確定した枠（converge ではこの値が後続の強制候補になる）。 */
  slotStart: EpochMs | null;
  slotEnd: EpochMs | null;
}

export interface CreateRelayStepInput {
  order: number;
  assigneeId: string;
  subMode: RelaySubMode;
  deadline?: EpochMs | null;
}
