/**
 * カレンダーの1日カラム内で、時間帯が重なる複数のブロック（実会議のダブルブッキング等）を
 * 横方向に列分割するための純粋関数（Googleカレンダー式のカラムレイアウト）。
 *
 * 背景：重なったまま同じ位置に描画すると、片方のタイトル・時刻テキストが下敷きになって
 * 完全に読めなくなる（社長指摘「読み込みミスは致命的」と同種の"見えなくなる"問題の再発防止）。
 */
export interface OverlapLayout {
  col: number;
  cols: number;
}

export function layoutOverlaps<T extends { start: number; end: number }>(
  items: T[],
): (T & OverlapLayout)[] {
  const sorted = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: (T & OverlapLayout & { i: number })[] = [];
  let cluster: { i: number }[] = [];
  let colEnds: number[] = [];
  let clusterMaxEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) {
      const found = result.find((r) => r.i === c.i);
      if (found) found.cols = cols;
    }
    cluster = [];
    colEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterMaxEnd) {
      flush();
      clusterMaxEnd = -Infinity;
    }
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[col] = it.end;
    }
    cluster.push({ i: it.i });
    clusterMaxEnd = Math.max(clusterMaxEnd, it.end);
    result.push({ ...it, col, cols: 1 });
  }
  flush();

  result.sort((a, b) => a.i - b.i);
  return result.map(({ i: _i, ...rest }) => rest as T & OverlapLayout);
}
