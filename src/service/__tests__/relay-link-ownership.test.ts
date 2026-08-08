/**
 * リレー型ステージの所有権検証テスト（2026-08-08 セキュリティレビュー H2）。
 *
 * ここが緩むと、他人のメールを ownerEmail に書くだけで
 * 「他人のカレンダーの空き状況を読む」「他人のカレンダーに予定を作る」
 * 「他人名義で任意の宛先へ招待メールを送る」が未認証でできてしまう。
 */
import { describe, it, expect } from 'vitest';
import {
  validateRelayStages,
  validateStagesOwnedBy,
  validateStageCalendarIds,
  type RelayStageDef,
} from '../relay-link.js';

const stage = (over: Partial<RelayStageDef> = {}): RelayStageDef => ({
  order: 1,
  label: '一次面接',
  ownerEmail: 'atsuhiro@takagi.bz',
  calendarIds: ['primary'],
  ...over,
});

describe('validateStagesOwnedBy', () => {
  it('全ステージが本人なら null（通す）', () => {
    const stages = [stage(), stage({ order: 2, ownerEmail: 'atsuhiro@takagi.bz' })];
    expect(validateStagesOwnedBy(stages, 'atsuhiro@takagi.bz')).toBeNull();
  });

  it('大文字小文字・前後空白の違いは同一人物として扱う', () => {
    expect(validateStagesOwnedBy([stage({ ownerEmail: ' Atsuhiro@Takagi.BZ ' })], 'atsuhiro@takagi.bz')).toBeNull();
  });

  it('他人のメールが1つでも混ざれば拒否する', () => {
    const stages = [stage(), stage({ order: 2, ownerEmail: 'victim@example.com' })];
    const err = validateStagesOwnedBy(stages, 'atsuhiro@takagi.bz');
    expect(err).not.toBeNull();
    expect(err).toContain('victim@example.com');
  });

  it('セッションのメールが取れない場合は拒否（fail-closed）', () => {
    expect(validateStagesOwnedBy([stage()], null)).not.toBeNull();
    expect(validateStagesOwnedBy([stage()], undefined)).not.toBeNull();
    expect(validateStagesOwnedBy([stage()], '')).not.toBeNull();
  });
});

describe('validateStageCalendarIds', () => {
  it('calendarList に実在するIDだけなら通す', () => {
    const stages = [stage({ calendarIds: ['work@takagi.bz'] })];
    expect(validateStageCalendarIds(stages, ['work@takagi.bz', 'other@takagi.bz'])).toBeNull();
  });

  it('primary は常に許可する', () => {
    expect(validateStageCalendarIds([stage({ calendarIds: ['primary'] })], [])).toBeNull();
  });

  it('アクセス権のないカレンダーIDは拒否する', () => {
    const stages = [stage({ calendarIds: ['victim@example.com'] })];
    const err = validateStageCalendarIds(stages, ['work@takagi.bz']);
    expect(err).not.toBeNull();
    expect(err).toContain('victim@example.com');
  });
});

describe('validateRelayStages のメール形式チェック強化', () => {
  it('@ を含むだけの不正な文字列は弾く', () => {
    expect(validateRelayStages([stage({ ownerEmail: 'not an email @' })])).not.toBeNull();
    expect(validateRelayStages([stage({ ownerEmail: '@' })])).not.toBeNull();
    expect(validateRelayStages([stage({ ownerEmail: 'a@b' })])).not.toBeNull();
    expect(validateRelayStages([stage({ ownerEmail: 'a@b.com,c@d.com' })])).not.toBeNull();
  });

  it('正しい形式は通す', () => {
    expect(validateRelayStages([stage({ ownerEmail: 'atsuhiro@takagi.bz' })])).toBeNull();
  });

  it('calendarIds が多すぎる場合は弾く', () => {
    const many = Array.from({ length: 51 }, (_, i) => `cal-${i}@x.jp`);
    expect(validateRelayStages([stage({ calendarIds: many })])).not.toBeNull();
  });
});
