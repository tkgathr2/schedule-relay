/**
 * 🔴 T6 リレー型サービス（仕様 §5・マスト機能）。
 * Repository の状態（RelayStep 行）を読み書きし、サブモード別の進行ルールを適用する。
 *
 * 3サブモード：
 *  - converge（既定）   ：全員が同一枠に収束。先頭が確定した枠を後続にも強制する。
 *  - chained            ：相対制約。Aの確定枠の直後（+gapMinutes）を次の候補とする。
 *  - independent        ：各自独立確定。共有リソース（organizer）は使わない＝先行者勝ち。
 *
 * 本サービスは「ステップを進める／差し戻す」までを担当し、実際のカレンダー書込・
 * Hold 確定は呼び出し側（API or 別サービス）が必要に応じて行う。
 */
import { MINUTE_MS, type RelaySubMode, type Slot } from '../domain/types.js';
import type { CreateRelayStepInput, RelayStepRec, Repository } from '../repo/types.js';
import { ServiceError } from './errors.js';

/** API レスポンス用：ステップを ISO 文字列付きで返す軽量 DTO。 */
export interface RelayStepDto {
  id: string;
  order: number;
  assigneeId: string;
  subMode: RelaySubMode;
  status: RelayStepRec['status'];
  deadline: string | null;
  slot: Slot | null;
}

export function stepToDto(s: RelayStepRec): RelayStepDto {
  return {
    id: s.id,
    order: s.order,
    assigneeId: s.assigneeId,
    subMode: s.subMode,
    status: s.status,
    deadline: s.deadline !== null ? new Date(s.deadline).toISOString() : null,
    slot:
      s.slotStart !== null && s.slotEnd !== null
        ? { start: s.slotStart, end: s.slotEnd }
        : null,
  };
}

/** リレーを初期化（一括作成）。 */
export async function createRelay(
  repo: Repository,
  eventId: string,
  steps: CreateRelayStepInput[],
): Promise<RelayStepDto[]> {
  if (steps.length === 0) {
    throw new ServiceError('VALIDATION', 'リレーには少なくとも1ステップが必要です');
  }
  // order が重複・欠番でないか軽くチェック。
  const orders = steps.map((s) => s.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) {
      throw new ServiceError('VALIDATION', 'order は 0 から連番である必要があります');
    }
  }
  const created = await repo.createRelaySteps(eventId, steps);
  return created.map(stepToDto);
}

/** 現在のステップ列を取得。 */
export async function listSteps(repo: Repository, eventId: string): Promise<RelayStepDto[]> {
  const steps = await repo.getRelaySteps(eventId);
  return steps.map(stepToDto);
}

/**
 * 現在 active のステップに与える「次の候補枠」を計算する。
 * - converge：先行ステップが確定済みならその枠を強制（候補は1つ）。未確定なら null。
 * - chained ：直前 done のステップの「終了時刻 + gapMinutes」を開始とする1枠を提示。
 * - independent：何もしない（呼び出し側が通常の空き算出を使う）。
 *
 * gapMinutes＝chained サブモードでの「直後」の幅（仕様 §5・最小実装：0 分）。
 */
export interface NextCandidateContext {
  activeStep: RelayStepRec;
  /** converge のときは強制枠 / chained のときは提示開始枠 / independent のときは null。 */
  enforcedSlot: Slot | null;
}

export async function computeNextCandidate(
  repo: Repository,
  eventId: string,
  durationMin = 30,
  gapMinutes = 0,
): Promise<NextCandidateContext | null> {
  const steps = await repo.getRelaySteps(eventId);
  if (steps.length === 0) return null;
  const active = steps.find((s) => s.status === 'active');
  if (!active) return null;

  if (active.subMode === 'converge') {
    // 直前までで done のうち、最初に確定した step（=先頭の done）の枠を採用。
    const firstDone = steps.find((s) => s.status === 'done' && s.slotStart !== null && s.slotEnd !== null);
    if (firstDone) {
      return {
        activeStep: active,
        enforcedSlot: { start: firstDone.slotStart!, end: firstDone.slotEnd! },
      };
    }
    return { activeStep: active, enforcedSlot: null };
  }

  if (active.subMode === 'chained') {
    // 直前の done を探し、終了 + gap を開始に。
    const dones = steps.filter((s) => s.status === 'done' && s.slotEnd !== null);
    if (dones.length === 0) return { activeStep: active, enforcedSlot: null };
    const prev = dones[dones.length - 1]!;
    const start = prev.slotEnd! + gapMinutes * MINUTE_MS;
    const end = start + durationMin * MINUTE_MS;
    return { activeStep: active, enforcedSlot: { start, end } };
  }

  // independent
  return { activeStep: active, enforcedSlot: null };
}

/**
 * 現在 active のステップを done にして、与えられた枠を記録する。次の waiting を active へ進める。
 * - converge：先頭が確定済みなら、後続は同一枠でないと拒否する（仕様 §5）。
 * - chained ：呼び出し側が「直前+gap」の枠を渡す責務。本関数は記録のみ。
 * - independent：枠の制約なし。
 *
 * 返り値：進行後のステップ一覧（DTO）。stepId が現在 active でなければ NOT_FOUND を投げる。
 */
export async function advanceStep(
  repo: Repository,
  eventId: string,
  stepId: string,
  slot: Slot,
): Promise<RelayStepDto[]> {
  const steps = await repo.getRelaySteps(eventId);
  if (steps.length === 0) {
    throw new ServiceError('NOT_FOUND', 'リレーステップが見つかりません');
  }
  const target = steps.find((s) => s.id === stepId);
  if (!target) throw new ServiceError('NOT_FOUND', 'ステップが見つかりません');
  if (target.status !== 'active') {
    throw new ServiceError('FORBIDDEN', '現在 active のステップではありません');
  }

  // converge：先頭が確定済みなら同一枠を強制（不一致は拒否）。
  if (target.subMode === 'converge') {
    const firstDone = steps.find((s) => s.status === 'done' && s.slotStart !== null && s.slotEnd !== null);
    if (firstDone) {
      if (firstDone.slotStart !== slot.start || firstDone.slotEnd !== slot.end) {
        throw new ServiceError(
          'CONFLICT_HOLD',
          'converge モードでは先行ステップが確定した枠と同一でなければなりません',
        );
      }
    }
  }

  const after = await repo.advanceRelay(eventId, stepId, slot);
  if (after === null) {
    throw new ServiceError('CONFLICT_HOLD', 'リレーの進行に失敗しました（状態が変化した可能性）');
  }
  return after.map(stepToDto);
}

/**
 * 差し戻し：指定 done ステップを active に戻し、以降の done/active を waiting に戻す。
 * converge で先頭まで戻したら、収束枠は自動的にクリア（後続は再び枠を選ぶ）。
 */
export async function rollbackStep(
  repo: Repository,
  eventId: string,
  stepId: string,
): Promise<RelayStepDto[]> {
  const after = await repo.rollbackRelay(eventId, stepId);
  if (after === null) {
    throw new ServiceError('NOT_FOUND', '差し戻し可能なステップではありません');
  }
  return after.map(stepToDto);
}

/**
 * 全体状況の総合判定。
 * - すべて done → 'confirmed'
 * - すべて settled だが skipped を含み converge → 'failed'
 * - それ以外 → 'in_progress'
 */
export type RelayStatus = 'in_progress' | 'confirmed' | 'failed';
export function relayStatus(steps: readonly RelayStepRec[]): RelayStatus {
  if (steps.length === 0) return 'in_progress';
  const allSettled = steps.every((s) => s.status === 'done' || s.status === 'skipped');
  if (!allSettled) return 'in_progress';
  const anySkipped = steps.some((s) => s.status === 'skipped');
  if (!anySkipped) return 'confirmed';
  // converge は全員一致が条件。1人でも欠けたら不成立。
  const isConverge = steps.every((s) => s.subMode === 'converge');
  return isConverge ? 'failed' : 'confirmed';
}
