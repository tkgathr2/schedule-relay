import { describe, it, expect } from 'vitest';
import { pickAssignee, applyAssignment, type RrMember } from '../roundrobin.js';

describe('決定論ラウンドロビン（§7-7・T5）', () => {
  it('未割当を最優先', () => {
    const members: RrMember[] = [
      { id: 'p1', lastAssignedAt: 1000 },
      { id: 'p2', lastAssignedAt: null },
    ];
    expect(pickAssignee(members)!.id).toBe('p2');
  });

  it('古い担当を優先（負荷分散）', () => {
    const members: RrMember[] = [
      { id: 'p1', lastAssignedAt: 5000 },
      { id: 'p2', lastAssignedAt: 1000 },
    ];
    expect(pickAssignee(members)!.id).toBe('p2');
  });

  it('同時刻は id 昇順', () => {
    const members: RrMember[] = [
      { id: 'pB', lastAssignedAt: 1000 },
      { id: 'pA', lastAssignedAt: 1000 },
    ];
    expect(pickAssignee(members)!.id).toBe('pA');
  });

  it('available=false は除外', () => {
    const members: RrMember[] = [
      { id: 'p1', lastAssignedAt: null, available: false },
      { id: 'p2', lastAssignedAt: 9000 },
    ];
    expect(pickAssignee(members)!.id).toBe('p2');
  });

  it('割当を回すと次は別の人（純関数・元配列不変）', () => {
    let members: RrMember[] = [
      { id: 'p1', lastAssignedAt: null },
      { id: 'p2', lastAssignedAt: null },
    ];
    const first = pickAssignee(members)!; // p1（id昇順）
    members = applyAssignment(members, first.id, 1000);
    const second = pickAssignee(members)!; // p2
    expect(first.id).toBe('p1');
    expect(second.id).toBe('p2');
  });
});
