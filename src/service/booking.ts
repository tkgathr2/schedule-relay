/**
 * 予約調整サービス（P2：T1 空き時間リンク / T2 確定型）。
 * ドメインコア（availability/grid）と Repository を結線し、仕様 §6/§7/§12/§14/§20 を満たす。
 *
 * 設計方針：
 *  - 時刻はすべて UTC epoch ms。表示TZは presentation 層。
 *  - 「いま」(now) は必ず引数で受ける＝決定論（テスト容易・サーバ時刻基準）。
 *  - カレンダー連携（Google/MS freebusy）は後続フェーズ。それまでは settings.busy を
 *    busy のスタンドインとして扱い、UIプレビュー/テストで実フローを成立させる。
 */
import { computeAvailability, inflate } from '../domain/availability.js';
import { isAligned, durationOf } from '../domain/grid.js';
import { GRID_MS, MINUTE_MS, type Interval, type Slot } from '../domain/types.js';
import { expandWorkingWindows, type WorkingHours } from '../domain/working-hours.js';
import type { BookingPageRec, ConfirmationRec, EventRec, HoldRec, Repository } from '../repo/types.js';
import { ConflictHoldError } from '../repo/types.js';
import { ServiceError } from './errors.js';
import { googleConfigForUserId } from './calendar/tenant.js';
import { createHoldPlaceholderEvent, deleteCalendarEvent } from './calendar/google.js';

/** §10 settings の解決済み形。未指定は既定で補完。 */
export interface ResolvedSettings {
  durationMin: number;
  gridMs: number;
  minNoticeMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  holdTtlMin: number;
  /** availability を展開する暦日数（地平線）。 */
  horizonDays: number;
  workingHours: WorkingHours;
  /** カレンダー連携前の busy スタンドイン（UTC）。 */
  busy: Interval[];
  /**
   * 固定候補リスト（社長要望・2026-08-13：/propose で選んだ候補「そのもの」を相手に提示する）。
   * 指定があれば、営業時間グリッドからの自動列挙ではなく、このリストのうち
   * まだ busy と重ならないものだけをそのまま availability として返す（§14 相当の拡張）。
   * 未指定（従来のT1空き時間リンク等）は今まで通りグリッド列挙。
   */
  fixedCandidates?: Slot[];
}

function toMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function parseBusy(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = toMs((item as Record<string, unknown>).start);
    const e = toMs((item as Record<string, unknown>).end);
    if (s !== null && e !== null && s < e) out.push({ start: s, end: e });
  }
  return out;
}

/** settings.candidates（/propose で選んだ固定候補リスト）を解決する。空/未指定は undefined。 */
function parseCandidates(raw: unknown): Slot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Slot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = toMs((item as Record<string, unknown>).start);
    const e = toMs((item as Record<string, unknown>).end);
    if (s !== null && e !== null && s < e) out.push({ start: s, end: e });
  }
  return out.length > 0 ? out : undefined;
}

/** settings(JSON) を既定で補完して解決する。 */
export function resolveSettings(raw: unknown): ResolvedSettings {
  const s = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const wh = (s.working_hours && typeof s.working_hours === 'object'
    ? (s.working_hours as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const buf = (s.buffer_minutes && typeof s.buffer_minutes === 'object'
    ? (s.buffer_minutes as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;

  return {
    durationMin: num(s.duration_minutes, 30),
    gridMs: num(s.grid_minutes, 15) * MINUTE_MS,
    minNoticeMin: num(s.min_notice_minutes, 0),
    bufferBeforeMin: num(buf.before, 0),
    bufferAfterMin: num(buf.after, 0),
    holdTtlMin: num(s.hold_ttl_minutes, 15),
    horizonDays: num(s.horizon_days, 14),
    workingHours: {
      tz: typeof wh.tz === 'string' ? wh.tz : 'Asia/Tokyo',
      mon_fri: strArr(wh.mon_fri) ?? ['09:00', '18:00'],
      mon: strArr(wh.mon),
      tue: strArr(wh.tue),
      wed: strArr(wh.wed),
      thu: strArr(wh.thu),
      fri: strArr(wh.fri),
      sat: strArr(wh.sat) ?? [],
      sun: strArr(wh.sun) ?? [],
    },
    busy: parseBusy(s.busy),
    fixedCandidates: parseCandidates(s.candidates),
  };
}

/**
 * ページの空き枠を算出（仕様 §14 GET /pages/{slug}/availability）。
 * extraBusy＝settings.busy 以外に差し引く busy（既存予約/仮押さえ・外部カレンダー freebusy 等）。
 * これにより「誰かが取った枠が空きから消える」「自分の予定が入った時間は出さない」を実現する。
 */
export function availabilityForPage(
  page: BookingPageRec,
  now: number,
  extraBusy: readonly Interval[] = [],
): Slot[] {
  const cfg = resolveSettings(page.settings);
  const busy = extraBusy.length ? [...cfg.busy, ...extraBusy] : cfg.busy;

  if (cfg.fixedCandidates) {
    // 固定候補モード（/propose で選んだ候補「そのもの」を提示する・社長要望2026-08-13）：
    // 営業時間グリッドからの自動列挙はせず、候補リストのうち now/min_notice を過ぎておらず
    // かつ busy（バッファ込み）と重ならないものだけを、そのまま返す。
    const earliest = now + cfg.minNoticeMin * MINUTE_MS;
    const inflatedBusy = inflate(busy, cfg.bufferBeforeMin * MINUTE_MS, cfg.bufferAfterMin * MINUTE_MS);
    return cfg.fixedCandidates
      .filter((c) => c.start >= earliest)
      .filter((c) => !inflatedBusy.some((b) => c.start < b.end && b.start < c.end))
      .sort((a, b) => a.start - b.start);
  }

  const windows = expandWorkingWindows(cfg.workingHours, now, cfg.horizonDays);
  return computeAvailability({
    workingWindows: windows,
    busy,
    durationMin: cfg.durationMin,
    minNoticeMin: cfg.minNoticeMin,
    bufferBeforeMin: cfg.bufferBeforeMin,
    bufferAfterMin: cfg.bufferAfterMin,
    now,
    gridMs: cfg.gridMs,
  });
}

/**
 * 「いま現在の本当の空き」を算出する（動的）。
 * リポジトリから「予約確定済み＋有効な仮押さえ中」の枠を取得して busy として差し引く。
 * ＝誰かが取った枠は即座に空きから消える。外部カレンダー連携の busy もここに合流させる。
 */
export async function liveAvailabilityForPage(
  repo: Repository,
  page: BookingPageRec,
  now: number,
  externalBusy: readonly Interval[] = [],
): Promise<Slot[]> {
  const booked = await repo.listBlockingIntervals(page.organizerId, now);
  return availabilityForPage(page, now, [...booked, ...externalBusy]);
}

function slotEq(a: Slot, b: Slot): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * 選択枠を検証する。失敗時は仕様 §20 の正しい code で ServiceError を投げる。
 * 検証順：PAST_TIME → GRID_VIOLATION → MIN_NOTICE → OUT_OF_HOURS(空き集合に無い)。
 */
export function validateSlot(page: BookingPageRec, slot: Slot, now: number): void {
  const cfg = resolveSettings(page.settings);

  if (slot.start <= now) throw new ServiceError('PAST_TIME', '過去または現在の枠は予約できません');

  if (!cfg.fixedCandidates) {
    const aligned = isAligned(slot.start, cfg.gridMs) && isAligned(slot.end, cfg.gridMs);
    if (!aligned || durationOf(slot) !== cfg.durationMin * MINUTE_MS) {
      throw new ServiceError('GRID_VIOLATION', `枠は${cfg.durationMin}分・15分グリッドに整列している必要があります`);
    }
  }

  if (slot.start < now + cfg.minNoticeMin * MINUTE_MS) {
    throw new ServiceError('MIN_NOTICE', `直前予約はできません（${cfg.minNoticeMin}分前まで）`);
  }

  const avail = availabilityForPage(page, now);
  if (!avail.some((s) => slotEq(s, slot))) {
    throw new ServiceError('OUT_OF_HOURS', '指定の枠は受付時間外、または既存予定と重なっています');
  }
}

export interface CreateEventResult {
  event: EventRec;
  reused: boolean;
}

/** イベント作成（§14 POST /events・冪等）。 */
export async function createEventForPage(
  repo: Repository,
  slug: string,
  idempotencyKey: string | null,
): Promise<CreateEventResult> {
  const page = await repo.getPageBySlug(slug);
  if (!page || !page.isActive) throw new ServiceError('NOT_FOUND', '予約ページが見つかりません');
  return repo.createEvent({ pageId: page.id, type: page.type, idempotencyKey });
}

export interface HoldResult {
  hold: HoldRec;
  expiresAt: number;
}

/** settings.title を読む（未設定なら既定文言）。確定時の予定名にも使う共通ヘルパー。 */
function pageTitle(page: BookingPageRec): string {
  const s = page.settings as { title?: unknown } | null;
  return s && typeof s.title === 'string' && s.title ? s.title : 'ご面談';
}

/**
 * リンク発行時に候補全部へ張る「自分用の仮押さえ」（社長要望：仮押さえ＝リンクを発行した
 * 瞬間から主催者本人の枠を抑える、の意）。
 *
 * 実運用フロー：
 *  - /propose で候補を選んで反映した瞬間、選んだ候補すべてに主催者カレンダー上で
 *    [調整中] の仮予定を作る（createSelfHoldsForPage）。
 *  - 相手が実際にどれか1枠を選んだ瞬間（holdSlot）、その枠の自分用仮押さえは
 *    重複表示を避けるため解除する（releaseSelfHoldForSlot）。
 *  - 相手が確定した瞬間（confirmHold）／主催者がページを取り消した瞬間、
 *    残っている自分用仮押さえを全部解除する（releaseAllSelfHoldsForPage）。
 *
 * 自分用仮押さえは resourceId を "self:{pageId}" という別名前空間にすることで、
 * 相手の実際の仮押さえ（resourceId=organizerId）と物理的な二重予約防止（EXCLUDE制約）を
 * 衝突させない。相手が同じ枠を選んだ瞬間は releaseSelfHoldForSlot で明示的に道を譲る。
 */
const SELF_HOLD_HOLDER_ID = 'organizer-self';
const SELF_HOLD_TTL_MIN = 180 * 24 * 60; // 180日＝TTLで自然失効させず、確定/取消で明示的に片付ける前提

/** JST の暦日キー（UTC+9固定オフセットでの日単位グルーピング用）。 */
function jstDayKey(ms: number): number {
  return Math.floor((ms + 9 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

/**
 * 候補一覧から「日ごとに代表1件（最も早い枠）」だけを間引く。
 * 相手に提示する候補（settings.candidates）はそのまま全部残す一方、
 * 自分用仮押さえ（カレンダー上の [調整中] プレースホルダー）は同じ日にブロックが
 * 密集しないよう、この間引き後のリストだけを使って作る。
 */
export function pickOneCandidatePerDay(slots: readonly Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const seenDays = new Set<number>();
  const out: Slot[] = [];
  for (const s of sorted) {
    const key = jstDayKey(s.start);
    if (seenDays.has(key)) continue;
    seenDays.add(key);
    out.push(s);
  }
  return out;
}

// 自分用仮押さえの最終安全弁（社長指示・2026-08-13）。
// 呼び出し側（propose.tsx）は既に「候補がある日ごとに代表1件」まで絞ってから渡してくるため、
// 通常はここに到達する時点で件数=対象日数になっている。ただし候補抽出件数(maxSlots)は最大200まで
// 選べる設定になっており、それら全部が異なる日に散らばる極端なケースでは200件近い仮押さえが
// 作られ得る。以前の事故（10件キャップが日付集中を招いた）を繰り返さないよう、
// 日ベースの絞り込みは維持したまま、通常の運用ではまず到達しない大きめの値を最後の歯止めとして置く。
const MAX_SELF_HOLD_SLOTS = 100;

function selfEventIdempotencyKey(pageId: string): string {
  return `self:${pageId}`;
}
function selfHoldResourceId(pageId: string): string {
  return `self:${pageId}`;
}

async function getOrCreateSelfEvent(repo: Repository, page: BookingPageRec): Promise<EventRec> {
  const { event } = await repo.createEvent({
    pageId: page.id,
    type: page.type,
    idempotencyKey: selfEventIdempotencyKey(page.id),
  });
  return event;
}

async function releaseSelfHold(repo: Repository, page: BookingPageRec, hold: HoldRec): Promise<void> {
  await repo.releaseHold(hold.id);
  if (!hold.googleEventId) return;
  try {
    const gcfg = await googleConfigForUserId(page.organizerId);
    if (gcfg) await deleteCalendarEvent(gcfg, hold.googleEventId);
  } catch {
    /* degrade-safe */
  }
}

/** リンク発行（候補反映）時：選んだ候補すべてに自分用の仮押さえを作る。degrade-safe。 */
export async function createSelfHoldsForPage(
  repo: Repository,
  page: BookingPageRec,
  slots: readonly Slot[],
  now: number,
): Promise<void> {
  if (slots.length === 0) return;
  const selfEvent = await getOrCreateSelfEvent(repo, page);
  const resourceId = selfHoldResourceId(page.id);
  const expiresAt = now + SELF_HOLD_TTL_MIN * MINUTE_MS;
  const gcfg = await googleConfigForUserId(page.organizerId);

  for (const slot of slots.slice(0, MAX_SELF_HOLD_SLOTS)) {
    let hold: HoldRec;
    try {
      const candidate = await repo.upsertCandidate(selfEvent.id, slot);
      const result = await repo.createActiveHold({
        eventId: selfEvent.id,
        candidateId: candidate.id,
        resourceId,
        holderId: SELF_HOLD_HOLDER_ID,
        slot,
        expiresAt,
        now,
      });
      hold = result.hold;
    } catch (e) {
      if (e instanceof ConflictHoldError) continue; // 選んだ候補同士が重複 → スキップ
      throw e;
    }

    if (!gcfg) continue;
    try {
      const googleEventId = await createHoldPlaceholderEvent(gcfg, {
        summary: `[調整中] ${pageTitle(page)}`,
        description:
          'この日時を候補として相手に提示中です。相手が確定するとこの予定は自動的に正式な予定に置き換わります（他の候補は確定時に自動で解除されます）。',
        startMs: slot.start,
        endMs: slot.end,
      });
      if (googleEventId) await repo.attachHoldGoogleEventId(hold.id, googleEventId);
    } catch {
      /* degrade-safe：カレンダー連携の失敗は仮押さえの成立に影響させない */
    }
  }
}

/** 相手が実際にその枠を選んだ瞬間：重複表示を避けるため、同じ枠の自分用仮押さえだけ解除する。degrade-safe。 */
export async function releaseSelfHoldForSlot(
  repo: Repository,
  page: BookingPageRec,
  slot: Slot,
  now: number,
): Promise<void> {
  try {
    const selfEvent = await getOrCreateSelfEvent(repo, page);
    const holds = await repo.listActiveHoldsByEvent(selfEvent.id, now);
    const match = holds.find((h) => h.start === slot.start && h.end === slot.end);
    if (match) await releaseSelfHold(repo, page, match);
  } catch {
    /* degrade-safe */
  }
}

/**
 * このページ自身の「自分用仮押さえ」が今どの区間を占めているかを返す。
 * /api/pages/{slug}/availability が、外部カレンダーfreebusyから自分自身の仮押さえ分を
 * 除外する（＝自分が提示した候補が自分自身の仮押さえのせいで空きから消えないようにする）ために使う。
 * degrade-safe：取得に失敗したら空配列（＝除外なし＝安全側）を返す。
 */
export async function listSelfHoldSlotsForPage(
  repo: Repository,
  page: BookingPageRec,
  now: number,
): Promise<Interval[]> {
  try {
    const selfEvent = await getOrCreateSelfEvent(repo, page);
    const holds = await repo.listActiveHoldsByEvent(selfEvent.id, now);
    return holds.map((h) => ({ start: h.start, end: h.end }));
  } catch {
    return [];
  }
}

/** 確定／取消時：残っている自分用仮押さえを全部解除する。degrade-safe。 */
export async function releaseAllSelfHoldsForPage(repo: Repository, page: BookingPageRec, now: number): Promise<void> {
  try {
    const selfEvent = await getOrCreateSelfEvent(repo, page);
    const holds = await repo.listActiveHoldsByEvent(selfEvent.id, now);
    for (const h of holds) await releaseSelfHold(repo, page, h);
  } catch {
    /* degrade-safe */
  }
}

/**
 * 枠を Hold（§14 POST /events/{id}/holds）。resourceId は主催者枠（1:1）。
 *
 * 相手が仮押さえした瞬間、主催者の Google カレンダーにも「[調整中]」という一時的な予定を
 * 作る（社長要望：Spir同様、仮押さえ中の枠も自分のカレンダー上で見えるようにしたい）。
 * カレンダー連携が失敗・未連携でも Hold 自体は成立させる（degrade-safe）。
 */
export async function holdSlot(
  repo: Repository,
  eventId: string,
  slot: Slot,
  holderId: string,
  now: number,
): Promise<HoldResult> {
  const event = await repo.getEvent(eventId);
  if (!event) throw new ServiceError('NOT_FOUND', 'イベントが見つかりません');
  const page = await repo.getPageById(event.pageId);
  if (!page) throw new ServiceError('NOT_FOUND', '予約ページが見つかりません');

  validateSlot(page, slot, now);

  const cfg = resolveSettings(page.settings);
  const candidate = await repo.upsertCandidate(eventId, slot);
  const expiresAt = now + cfg.holdTtlMin * MINUTE_MS;

  let hold: HoldRec;
  let releasedExpiredGoogleEventIds: string[];
  try {
    const result = await repo.createActiveHold({
      eventId,
      candidateId: candidate.id,
      resourceId: page.organizerId, // 主催者カレンダー＝共有リソース（§12）
      holderId,
      slot,
      expiresAt,
      now,
    });
    hold = result.hold;
    releasedExpiredGoogleEventIds = result.releasedExpiredGoogleEventIds;
  } catch (e) {
    if (e instanceof ConflictHoldError) {
      throw new ServiceError('CONFLICT_HOLD', 'この枠は既に他の予約で押さえられています');
    }
    throw e;
  }

  try {
    const gcfg = await googleConfigForUserId(page.organizerId);
    if (gcfg) {
      // 期限切れで解放された他Holdの「[調整中]」仮予定を先に掃除する。
      for (const evId of releasedExpiredGoogleEventIds) {
        await deleteCalendarEvent(gcfg, evId);
      }
      const googleEventId = await createHoldPlaceholderEvent(gcfg, {
        summary: `[調整中] ${pageTitle(page)}`,
        description:
          '相手が候補日程を仮押さえ中です。確定するとこの予定は自動的に正式な予定に置き換わります。',
        startMs: slot.start,
        endMs: slot.end,
      });
      if (googleEventId) await repo.attachHoldGoogleEventId(hold.id, googleEventId);
    }
  } catch {
    /* degrade-safe：カレンダー連携の失敗は仮押さえの成立に影響させない */
  }

  // 相手が実際にこの枠を選んだので、リンク発行時に張っておいた「自分用の仮押さえ」
  // （この枠ぶん）は重複表示になるため解除する（degrade-safe・releaseSelfHoldForSlot内部で保護済み）。
  await releaseSelfHoldForSlot(repo, page, slot, now);

  return { hold, expiresAt };
}

/**
 * 相手が別の枠を選び直した／選択を取り消したときに、直前の仮押さえを明示的に解放する。
 * holderId が一致しない解放要求は無視する（他人のholdを勝手に解放させない）。
 * 対応する「[調整中]」仮予定があればカレンダーからも削除する（degrade-safe）。
 */
export async function releaseHeldSlot(repo: Repository, holdId: string, holderId: string): Promise<void> {
  const hold = await repo.getHold(holdId);
  if (!hold) return;
  if (hold.holderId !== holderId) throw new ServiceError('FORBIDDEN', 'この仮押さえを解放する権限がありません');
  if (hold.status !== 'active') return; // 既に確定/解放済みなら何もしない

  await repo.releaseHold(holdId);

  if (!hold.googleEventId) return;
  try {
    const ev = await repo.getEvent(hold.eventId);
    const page = ev ? await repo.getPageById(ev.pageId) : null;
    const gcfg = page ? await googleConfigForUserId(page.organizerId) : null;
    if (gcfg) await deleteCalendarEvent(gcfg, hold.googleEventId);
  } catch {
    /* degrade-safe */
  }
}

/**
 * 確定（§14 POST /events/{id}/confirm）。holderId と participantId 一致を要求。
 * 確定済みHold自身・破棄された他候補の「[調整中]」仮予定はここで掃除する
 * （正式な確定予定の作成は呼び出し元 /api/events/{id}/confirm が別途行う）。
 */
export async function confirmHold(
  repo: Repository,
  holdId: string,
  participantId: string,
  formAnswers: unknown,
  now: number,
): Promise<ConfirmationRec> {
  const hold = await repo.getHold(holdId);
  if (!hold) throw new ServiceError('NOT_FOUND', 'Hold が見つかりません');
  if (hold.holderId !== participantId) {
    throw new ServiceError('FORBIDDEN', 'この Hold を確定する権限がありません');
  }

  const result = await repo.confirmHold(holdId, { participantId, formAnswers, now });
  if (!result) {
    // active かつ TTL 超過＝期限切れ／released＝他確定で破棄 or 解放。いずれも確定不可。
    const latest = await repo.getHold(holdId);
    if (latest && latest.status === 'active' && latest.expiresAt <= now) {
      throw new ServiceError('EXPIRED', 'Hold の有効期限が切れています');
    }
    throw new ServiceError('EXPIRED', 'この枠は確定できません（期限切れ、または他の確定により解放済み）');
  }

  let page: BookingPageRec | null = null;
  try {
    const ev = await repo.getEvent(hold.eventId);
    page = ev ? await repo.getPageById(ev.pageId) : null;
    const gcfg = page ? await googleConfigForUserId(page.organizerId) : null;
    if (gcfg) {
      const toDelete = [result.confirmedHoldGoogleEventId, ...result.releasedGoogleEventIds].filter(
        (id): id is string => !!id,
      );
      for (const evId of toDelete) {
        await deleteCalendarEvent(gcfg, evId);
      }
    }
  } catch {
    /* degrade-safe */
  }

  // 確定したので、リンク発行時に張った「自分用の仮押さえ」のうち残り（選ばれなかった候補）を
  // 全部解除する（degrade-safe・releaseAllSelfHoldsForPage内部で保護済み）。
  if (page) await releaseAllSelfHoldsForPage(repo, page, now);

  return result.confirmation;
}
