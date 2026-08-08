/**
 * ログイン許可リスト（ALLOWED_EMAILS）の判定テスト。
 * ここが緩むと「Googleアカウントを持つ全世界の人」が社長のカレンダーを触れるので、
 * fail-closed（未設定なら全拒否）を最重要ケースとして固定する。
 */
import { describe, it, expect } from 'vitest';
import { isAllowedEmail, parseAllowedEmails } from '../allowlist.js';

describe('parseAllowedEmails', () => {
  it('カンマ区切りを分解し、前後空白と大文字小文字を正規化する', () => {
    expect(parseAllowedEmails(' Atsuhiro@Takagi.bz , foo@example.com ')).toEqual([
      'atsuhiro@takagi.bz',
      'foo@example.com',
    ]);
  });

  it('未設定・空文字は空配列', () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails('')).toEqual([]);
  });

  it('余分なカンマは無視する', () => {
    expect(parseAllowedEmails('a@x.jp,,b@x.jp,')).toEqual(['a@x.jp', 'b@x.jp']);
  });
});

describe('isAllowedEmail', () => {
  const LIST = 'atsuhiro@takagi.bz';

  it('許可リストに含まれるアドレスは true', () => {
    expect(isAllowedEmail('atsuhiro@takagi.bz', LIST)).toBe(true);
  });

  it('大文字小文字・前後空白は無視して一致させる', () => {
    expect(isAllowedEmail('  Atsuhiro@Takagi.BZ ', LIST)).toBe(true);
  });

  it('リスト外のアドレスは false', () => {
    expect(isAllowedEmail('someone@gmail.com', LIST)).toBe(false);
  });

  it('メールが無い（Google が返さなかった）場合は false', () => {
    expect(isAllowedEmail(null, LIST)).toBe(false);
    expect(isAllowedEmail(undefined, LIST)).toBe(false);
    expect(isAllowedEmail('', LIST)).toBe(false);
  });

  it('ALLOWED_EMAILS 未設定なら誰も入れない（fail-closed）', () => {
    expect(isAllowedEmail('atsuhiro@takagi.bz', undefined)).toBe(false);
    expect(isAllowedEmail('atsuhiro@takagi.bz', '')).toBe(false);
  });

  it('部分一致では通さない（サフィックス偽装の防止）', () => {
    expect(isAllowedEmail('evil-atsuhiro@takagi.bz', LIST)).toBe(false);
    expect(isAllowedEmail('atsuhiro@takagi.bz.evil.com', LIST)).toBe(false);
  });
});
