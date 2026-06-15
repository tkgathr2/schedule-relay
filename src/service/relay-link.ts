/**
 * RelayLink サービス層（リレー型 T6 リンク）。
 * - 候補列挙：各ステージのGoogle busyを並列取得し、enumerateRelayCandidates へ受け渡し
 * - 予約：各ステージのGoogleカレンダーに provisional ホールドイベントを作成、DB に RelayLinkHold を1行ずつ
 * 単体テスト容易性のため、Google 依存は呼び出し側で注入（busyByStage を渡せる）。
 */
import {
  enumerateRelayCandidates,
  type RelayCandidate,
  type RelayCandidatesInput,
} from '../domain/relay-link.js';
import { expandWorkingWindows, type WorkingHours } from '../domain/working-hours.js';
import type { Interval } from '../domain/types.js';

export interface RelayStageDef {
  order: number;
  label: string;
  ownerEmail: string;
  calendarIds: string[];
}

export interface RelayComputeInput {
  stages: readonly RelayStageDef[];
  durationMinutes: number;
  bufferMinutes?: number;
  maxGapDays?: number;
  startDate?: number; // ms
  endDate?: number; // ms
  /** 各ステージごとの busy（Google APIから注入。未連携時は空配列）。 */
  busyByStage: ReadonlyMap<number, Interval[]>;
  workingHours?: WorkingHours;
  now: number;
  maxCandidates?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const RELAY_DEFAULT_WORKING_HOURS: WorkingHours = {
  tz: 'Asia/Tokyo',
  mon_fri: ['09:00', '18:00'],
  sat: [],
  sun: [],
};

/**
 * 順序付き連続候補を計算する純関数。Google API への依存はない（busyByStage で注入）。
 */
export function computeRelayCandidates(input: RelayComputeInput): RelayCandidate[] {
  const wh = input.workingHours ?? RELAY_DEFAULT_WORKING_HOURS;
  const periodStart = input.startDate ?? input.now;
  const periodEnd =
    input.endDate ?? input.now + Math.max(input.maxGapDays ?? 14, 14) * DAY_MS + 7 * DAY_MS;

  if (periodEnd <= periodStart) return [];

  const days = Math.max(1, Math.ceil((periodEnd - periodStart) / DAY_MS) + 1);
  const allWindows = expandWorkingWindows(wh, periodStart, days);
  const workingWindows: Interval[] = allWindows
    .map((w) => ({
      start: Math.max(w.start, periodStart),
      end: Math.min(w.end, periodEnd),
    }))
    .filter((w) => w.start < w.end);

  const stageInputs = [...input.stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      order: s.order,
      label: s.label,
      workingWindows,
      busy: input.busyByStage.get(s.order) ?? [],
    }));

  const args: RelayCandidatesInput = {
    stages: stageInputs,
    durationMin: input.durationMinutes,
    bufferMinutes: input.bufferMinutes,
    maxGapDays: input.maxGapDays,
    now: input.now,
    maxCandidates: input.maxCandidates,
  };
  return enumerateRelayCandidates(args);
}

/**
 * RelayLink 作成時のバリデーション。重複order・空ラベル・空ownerEmailを弾く。
 */
export function validateRelayStages(stages: readonly RelayStageDef[]): string | null {
  if (!Array.isArray(stages) || stages.length === 0) return 'stages は1件以上必要です';
  if (stages.length > 10) return 'stages は10件までです';
  const seen = new Set<number>();
  for (const s of stages) {
    if (!Number.isInteger(s.order) || s.order < 1) return `order が不正です (${s.order})`;
    if (seen.has(s.order)) return `order が重複しています (${s.order})`;
    seen.add(s.order);
    if (typeof s.label !== 'string' || s.label.length === 0) return 'label は必須です';
    if (typeof s.ownerEmail !== 'string' || !s.ownerEmail.includes('@'))
      return `ownerEmail が不正です (${s.ownerEmail})`;
    if (!Array.isArray(s.calendarIds)) return 'calendarIds は配列で指定してください';
  }
  return null;
}

/**
 * スラッグを生成（小文字英数字＋ハイフン、12文字）。
 */
export function generateSlug(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
