/**
 * ドメイン共通型。
 * 時刻はすべて UTC epoch ミリ秒（number）で扱う（仕様 §7-1：時刻はUTC保存）。
 * 表示TZ変換は presentation 層の責務であり、ドメインは常にUTCで決定論的に計算する。
 */

/** UTC epoch ミリ秒。 */
export type EpochMs = number;

/** 半開区間 [start, end)（仕様 §7-3）。end は次区間の start と重なってよい。 */
export interface Interval {
  /** 開始（含む） */
  readonly start: EpochMs;
  /** 終了（含まない） */
  readonly end: EpochMs;
}

/** 確定候補となる枠。15分グリッドに整列している前提（不変条件は grid.ts が担保）。 */
export interface Slot extends Interval {}

/** 調整タイプ（仕様 §4）。 */
export type AdjustmentType = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';

/** リレー型サブモード（仕様 §5）。 */
export type RelaySubMode = 'converge' | 'chained' | 'independent';

/** 15分 = グリッド単位（ミリ秒）。仕様 §7-2。 */
export const GRID_MS = 15 * 60 * 1000;

/** 1分（ミリ秒）。 */
export const MINUTE_MS = 60 * 1000;
