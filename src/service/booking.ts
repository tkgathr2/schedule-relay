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
import { computeAvailability } from '../domain/availability.js';
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
  const windows = expandWorkingWindows(cfg.workingHours, now, cfg.horizonDays);
  const busy = extraBusy.length ? [...cfg.busy, ...extraBusy] : cfg.busy;
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

  const aligned = isAligned(slot.start, cfg.gridMs) && isAligned(slot.end, cfg.gridMs);
  if (!aligned || durationOf(slot) !== cfg.durationMin * MINUTE_MS) {
    throw new ServiceError('GRID_VIOLATION', `枠は${cfg.durationMin}分・15分グリッドに整列している必要があります`);
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

  return { hold, expiresAt };
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

  try {
    const ev = await repo.getEvent(hold.eventId);
    const page = ev ? await repo.getPageById(ev.pageId) : null;
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

  return result.confirmation;
}
