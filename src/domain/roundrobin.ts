/**
 * 決定論的ラウンドロビン（仕様 §7-7・T5）。
 * 次の担当を一意に決める：last_assigned_at 昇順 → id 昇順。
 * 乱数・実行時刻に依存しない（同じ入力なら常に同じ担当）。
 */

export interface RrMember {
  readonly id: string;
  /** 最終割当時刻（UTC epoch ms）。未割当は null。 */
  readonly lastAssignedAt: number | null;
  /** 受付可能か（休暇等で外すときに false）。 */
  readonly available?: boolean;
}

/**
 * 次に割り当てる担当を返す。
 * 未割当(null)は最優先（-Infinity 相当）。同点は id 昇順。
 * 受付可能メンバーが無ければ null。
 */
export function pickAssignee(members: readonly RrMember[]): RrMember | null {
  const pool = members.filter((m) => m.available !== false);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const la = a.lastAssignedAt ?? -Infinity;
    const lb = b.lastAssignedAt ?? -Infinity;
    if (la !== lb) return la - lb; // 古い方（未割当が最優先）
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
}

/**
 * 割当を確定したメンバー集合を返す（純関数・元配列は不変）。
 * 選ばれた担当の lastAssignedAt を assignedAt に更新する。
 */
export function applyAssignment(
  members: readonly RrMember[],
  assigneeId: string,
  assignedAt: number,
): RrMember[] {
  return members.map((m) => (m.id === assigneeId ? { ...m, lastAssignedAt: assignedAt } : m));
}
