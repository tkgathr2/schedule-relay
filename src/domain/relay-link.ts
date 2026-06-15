/**
 * 🔴 リレー型 T6 リンク = 順序付き連続候補列挙（Spirとの最大の差別化）。
 *
 * 採用面接など「一次面接担当A → 二次面接担当B → 最終面接担当C」を、
 * 順番付きで全員と都合の合う連続候補を返す純関数。
 *
 * アルゴリズム（決定論）：
 *   ① 各ステージごとに computeAvailability で free な duration 枠を列挙
 *   ② ステージ1の各枠 s1 について、s2 は s1.end + buffer 以降の枠だけ採用
 *      ステージ3の各枠 s3 は s2.end + buffer 以降、かつ s1.start と s_last.start の差が
 *      maxGap 以内であること
 *   ③ DFSで上から最大 maxCandidates 件まで列挙（ステージ1優先・start昇順）
 *
 * 副作用なし・UTC epoch ms で計算。
 */
import { computeAvailability } from './availability.js';
import type { Interval, Slot } from './types.js';

export interface RelayStageInput {
  /** 1始まりの順序（DBと同じ）。 */
  readonly order: number;
  /** 表示ラベル（"A", "B", "一次面接" など）。 */
  readonly label: string;
  /** そのステージ担当の解決済み営業時間ウィンドウ（UTC）。 */
  readonly workingWindows: readonly Interval[];
  /** そのステージ担当の busy（UTC）。 */
  readonly busy: readonly Interval[];
}

export interface RelayCandidatesInput {
  readonly stages: readonly RelayStageInput[];
  /** 枠の長さ（分）。 */
  readonly durationMin: number;
  /** 各ステージ間の最小バッファ（分）。既定15。 */
  readonly bufferMinutes?: number;
  /** ステージ1.start と最終ステージ.start の最大日数差。既定14。 */
  readonly maxGapDays?: number;
  /** 直前ブロック（分）。既定0。 */
  readonly minNoticeMin?: number;
  /** 現在時刻（UTC epoch ms）。 */
  readonly now: number;
  /** 返す最大候補数。既定12。 */
  readonly maxCandidates?: number;
}

/** 1候補 = 各ステージの確定枠の列。order昇順。 */
export interface RelayCandidate {
  readonly stages: readonly { order: number; label: string; start: number; end: number }[];
}

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 順序付き連続候補を列挙する。
 * 「先頭から順に A→B→C となる時間帯のみ提示」する＝stage[i].end + buffer <= stage[i+1].start を必須条件にする。
 */
export function enumerateRelayCandidates(input: RelayCandidatesInput): RelayCandidate[] {
  const stages = [...input.stages].sort((a, b) => a.order - b.order);
  if (stages.length === 0) return [];

  const durationMin = input.durationMin;
  const bufferMs = (input.bufferMinutes ?? 15) * MIN_MS;
  const maxGapMs = (input.maxGapDays ?? 14) * DAY_MS;
  const maxCandidates = Math.max(1, input.maxCandidates ?? 12);
  const minNoticeMin = input.minNoticeMin ?? 0;

  // ① 各ステージの空き枠（start昇順）
  const perStageSlots: Slot[][] = stages.map((s) =>
    computeAvailability({
      workingWindows: s.workingWindows,
      busy: s.busy,
      durationMin,
      minNoticeMin,
      now: input.now,
    }),
  );

  // 早期終了: どこかのステージが空きゼロ → 候補なし
  if (perStageSlots.some((arr) => arr.length === 0)) return [];

  const out: RelayCandidate[] = [];

  // ② DFS でステージ順に「直前.end + buffer <= 今.start」を満たす枠だけ採用
  function dfs(
    stageIdx: number,
    chosen: { order: number; label: string; start: number; end: number }[],
    firstStart: number,
  ): void {
    if (out.length >= maxCandidates) return;

    if (stageIdx === stages.length) {
      out.push({ stages: chosen.slice() });
      return;
    }

    const slots = perStageSlots[stageIdx]!;
    const stage = stages[stageIdx]!;
    const prev = chosen[chosen.length - 1];
    const minStart = prev !== undefined ? prev.end + bufferMs : -Infinity;

    for (const slot of slots) {
      if (out.length >= maxCandidates) return;
      if (slot.start < minStart) continue;
      // maxGap チェック：先頭.start と現在.start の差が制限内
      if (firstStart !== -Infinity && slot.start - firstStart > maxGapMs) {
        // start 昇順なので、これ以降の同ステージ枠もすべて違反 → break
        break;
      }
      chosen.push({ order: stage.order, label: stage.label, start: slot.start, end: slot.end });
      const nextFirst = firstStart === -Infinity ? slot.start : firstStart;
      dfs(stageIdx + 1, chosen, nextFirst);
      chosen.pop();
    }
  }

  dfs(0, [], -Infinity);
  return out;
}
