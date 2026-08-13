import { describe, it, expect } from 'vitest';
import { layoutOverlaps } from '../calendar-layout.js';

const T0 = Date.UTC(2026, 7, 13, 0, 0, 0); // 2026-08-13T00:00:00Z
const m = (min: number) => T0 + min * 60_000;

describe('layoutOverlaps（週カレンダーの重なるbusyブロックを横方向に列分割）', () => {
  it('重ならないブロックは全て cols=1・col=0（従来どおり全幅で描画される）', () => {
    const items = [
      { key: 'a', start: m(0), end: m(60) },
      { key: 'b', start: m(60), end: m(120) },
      { key: 'c', start: m(180), end: m(240) },
    ];
    const out = layoutOverlaps(items);
    expect(out.map((o) => ({ key: o.key, col: o.col, cols: o.cols }))).toEqual([
      { key: 'a', col: 0, cols: 1 },
      { key: 'b', col: 0, cols: 1 },
      { key: 'c', col: 0, cols: 1 },
    ]);
  });

  it('ダブルブッキング（2件が時間帯重複）は2カラムに分割され、両方とも読める位置になる', () => {
    const items = [
      { key: 'A', start: m(0), end: m(90) },
      { key: 'B', start: m(30), end: m(60) },
    ];
    const out = layoutOverlaps(items);
    const a = out.find((o) => o.key === 'A')!;
    const b = out.find((o) => o.key === 'B')!;
    expect(a.cols).toBe(2);
    expect(b.cols).toBe(2);
    expect(a.col).not.toBe(b.col);
  });

  it('3件が同時に重なる場合は3カラムに分割される', () => {
    const items = [
      { key: 'A', start: m(0), end: m(60) },
      { key: 'B', start: m(0), end: m(60) },
      { key: 'C', start: m(0), end: m(60) },
    ];
    const out = layoutOverlaps(items);
    const cols = new Set(out.map((o) => o.col));
    expect(cols.size).toBe(3);
    expect(out.every((o) => o.cols === 3)).toBe(true);
  });

  it('元の配列の順序（入力順）を保って返す（呼び出し側のkey対応が崩れない）', () => {
    const items = [
      { key: 'late', start: m(120), end: m(180) },
      { key: 'early', start: m(0), end: m(60) },
    ];
    const out = layoutOverlaps(items);
    expect(out.map((o) => o.key)).toEqual(['late', 'early']);
  });

  it('重なりが解消されて別クラスタになった場合、それぞれ独立に列数が決まる（前のクラスタの重なりを引きずらない）', () => {
    const items = [
      { key: 'A', start: m(0), end: m(60) },
      { key: 'B', start: m(0), end: m(60) }, // A,Bは重なる→2カラム
      { key: 'C', start: m(120), end: m(180) }, // 独立・重ならない→1カラム
    ];
    const out = layoutOverlaps(items);
    expect(out.find((o) => o.key === 'A')!.cols).toBe(2);
    expect(out.find((o) => o.key === 'B')!.cols).toBe(2);
    expect(out.find((o) => o.key === 'C')!.cols).toBe(1);
  });

  it('境界が接するだけ（後続がちょうど終了時刻に開始）は重なりとみなさない', () => {
    const items = [
      { key: 'A', start: m(0), end: m(60) },
      { key: 'B', start: m(60), end: m(120) },
    ];
    const out = layoutOverlaps(items);
    expect(out.find((o) => o.key === 'A')!.cols).toBe(1);
    expect(out.find((o) => o.key === 'B')!.cols).toBe(1);
  });

  it('空配列を渡しても壊れない', () => {
    expect(layoutOverlaps([])).toEqual([]);
  });
});
