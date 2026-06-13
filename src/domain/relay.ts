/**
 * 🔴 T6 リレー型 状態機械（仕様 §5・マスト機能）。
 * A→B→C と1人ずつ順番に確定する。3サブモード：converge / chained / independent。
 * すべて純関数（状態を受け取り新しい状態を返す）。副作用なし＝決定論的。
 */
import type { RelaySubMode, Slot } from './types.js';

export type RelayStepStatus = 'waiting' | 'active' | 'done' | 'skipped';

export interface RelayStep {
  /** リレー順（0始まり・作成時に固定）。 */
  readonly order: number;
  readonly assigneeId: string;
  readonly status: RelayStepStatus;
  /** その人が確定した枠（done時に入る）。 */
  readonly slot?: Slot;
}

export interface RelayState {
  readonly subMode: RelaySubMode;
  readonly steps: readonly RelayStep[];
  /** converge：全員が収束する枠（先頭が確定した枠）。 */
  readonly convergeSlot: Slot | null;
}

export type RelayStatus = 'in_progress' | 'confirmed' | 'failed';

/** 同一枠か（半開区間の端点まで一致）。 */
function sameSlot(a: Slot, b: Slot): boolean {
  return a.start === b.start && a.end === b.end;
}

/** リレーを初期化。先頭を active、残りを waiting にする。 */
export function initRelay(assigneeIds: readonly string[], subMode: RelaySubMode): RelayState {
  if (assigneeIds.length === 0) throw new Error('relay requires at least one assignee');
  const steps: RelayStep[] = assigneeIds.map((assigneeId, order) => ({
    order,
    assigneeId,
    status: order === 0 ? 'active' : 'waiting',
  }));
  return { subMode, steps, convergeSlot: null };
}

function indexOfActive(state: RelayState): number {
  return state.steps.findIndex((s) => s.status === 'active');
}

/** 次の waiting を active にする（無ければ何もしない）。 */
function activateNext(steps: readonly RelayStep[]): RelayStep[] {
  const next = steps.findIndex((s) => s.status === 'waiting');
  if (next === -1) return [...steps];
  return steps.map((s, i) => (i === next ? { ...s, status: 'active' } : s));
}

/**
 * active な担当が枠を確定（受諾）する。
 * - converge：先頭は slot 必須＝収束枠を決める。以降は収束枠と一致必須（不一致は例外）。
 * - chained / independent：各自 slot を確定。
 */
export function accept(state: RelayState, actorId: string, slot: Slot): RelayState {
  const idx = indexOfActive(state);
  if (idx === -1) throw new Error('no active step');
  const step = state.steps[idx]!;
  if (step.assigneeId !== actorId) throw new Error('not your turn');

  let convergeSlot = state.convergeSlot;
  if (state.subMode === 'converge') {
    if (convergeSlot === null) {
      convergeSlot = slot; // 先頭が収束枠を決める
    } else if (!sameSlot(convergeSlot, slot)) {
      throw new Error('converge: slot must equal the converged slot');
    }
  }

  let steps = state.steps.map((s, i) => (i === idx ? { ...s, status: 'done' as const, slot } : s));
  steps = activateNext(steps);
  return { ...state, steps, convergeSlot };
}

/** active な担当を skipped にして次へ進める（期限切れ・辞退）。 */
export function skip(state: RelayState, actorId?: string): RelayState {
  const idx = indexOfActive(state);
  if (idx === -1) throw new Error('no active step');
  const step = state.steps[idx]!;
  if (actorId !== undefined && step.assigneeId !== actorId) throw new Error('not your turn');
  let steps = state.steps.map((s, i) => (i === idx ? { ...s, status: 'skipped' as const } : s));
  steps = activateNext(steps);
  return { ...state, steps };
}

/**
 * 差し戻し：直近の done を active に戻し、それ以降を waiting へ戻す（仕様 §5）。
 * converge で先頭まで戻したら収束枠もクリアする。
 */
export function rollback(state: RelayState): RelayState {
  // 最後に done になったステップを探す
  let lastDone = -1;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (state.steps[i]!.status === 'done') {
      lastDone = i;
      break;
    }
  }
  if (lastDone === -1) throw new Error('nothing to roll back');
  const steps = state.steps.map((s, i) => {
    if (i < lastDone) return s;
    if (i === lastDone) return { order: s.order, assigneeId: s.assigneeId, status: 'active' as const };
    return { order: s.order, assigneeId: s.assigneeId, status: 'waiting' as const };
  });
  const convergeSlot = state.subMode === 'converge' && lastDone === 0 ? null : state.convergeSlot;
  return { ...state, steps, convergeSlot };
}

/**
 * 現在の総合ステータス。
 * - 全ステップが done → confirmed
 * - 全ステップが終了（done/skipped）だが done が一部欠ける → converge は failed、その他は confirmed（確定者のみ成立）
 * - それ以外 → in_progress
 */
export function status(state: RelayState): RelayStatus {
  const allSettled = state.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  if (!allSettled) return 'in_progress';
  const anySkipped = state.steps.some((s) => s.status === 'skipped');
  if (!anySkipped) return 'confirmed';
  // converge は全員一致が条件 → 1人でも欠けたら不成立
  return state.subMode === 'converge' ? 'failed' : 'confirmed';
}
