import { describe, it, expect } from 'vitest';
import { initRelay, accept, skip, rollback, status } from '../relay.js';
import type { Slot } from '../types.js';

const slot = (h: number): Slot => ({
  start: Date.UTC(2026, 5, 15, h, 0, 0),
  end: Date.UTC(2026, 5, 15, h, 30, 0),
});

describe('T6 relay converge（マスト・§22 シナリオ）', () => {
  it('A→B→C 全員同一枠で confirmed', () => {
    let s = initRelay(['A', 'B', 'C'], 'converge');
    expect(s.steps[0]!.status).toBe('active');
    s = accept(s, 'A', slot(10)); // 先頭が収束枠を決める
    expect(s.convergeSlot).toEqual(slot(10));
    expect(s.steps[1]!.status).toBe('active');
    s = accept(s, 'B', slot(10));
    s = accept(s, 'C', slot(10));
    expect(status(s)).toBe('confirmed');
  });

  it('収束枠と違う枠は拒否される', () => {
    let s = initRelay(['A', 'B'], 'converge');
    s = accept(s, 'A', slot(10));
    expect(() => accept(s, 'B', slot(11))).toThrow(/converged slot/);
  });

  it('順番でない人は確定できない', () => {
    const s = initRelay(['A', 'B'], 'converge');
    expect(() => accept(s, 'B', slot(10))).toThrow(/not your turn/);
  });

  it('converge で1人 skip すると failed（全員一致が条件）', () => {
    let s = initRelay(['A', 'B'], 'converge');
    s = accept(s, 'A', slot(10));
    s = skip(s, 'B');
    expect(status(s)).toBe('failed');
  });
});

describe('T6 relay independent', () => {
  it('各自独立に確定すれば skip があっても確定者で成立', () => {
    let s = initRelay(['A', 'B'], 'independent');
    s = accept(s, 'A', slot(9));
    s = accept(s, 'B', slot(14)); // 別枠でOK
    expect(status(s)).toBe('confirmed');
  });
});

describe('T6 relay rollback（差し戻し §5）', () => {
  it('直近の done を active に戻し以降を waiting へ', () => {
    let s = initRelay(['A', 'B', 'C'], 'converge');
    s = accept(s, 'A', slot(10));
    s = accept(s, 'B', slot(10));
    s = rollback(s); // B を active に戻す
    expect(s.steps[1]!.status).toBe('active');
    expect(s.steps[2]!.status).toBe('waiting');
    expect(s.convergeSlot).toEqual(slot(10)); // 先頭は done のまま → 収束枠維持
  });

  it('先頭まで戻すと収束枠もクリア', () => {
    let s = initRelay(['A', 'B'], 'converge');
    s = accept(s, 'A', slot(10));
    s = rollback(s);
    expect(s.steps[0]!.status).toBe('active');
    expect(s.convergeSlot).toBeNull();
  });
});
