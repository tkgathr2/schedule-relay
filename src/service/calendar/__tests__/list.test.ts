/**
 * listGoogleCalendars の degrade-safe 検証。
 * 認証失敗時は [] を返し、候補抽出UIが壊れないこと。
 */
import { describe, it, expect } from 'vitest';
import { listGoogleCalendars } from '../google.js';

describe('listGoogleCalendars (degrade-safe)', () => {
  it('不正な認証情報でも例外で落ちずに [] を返す', async () => {
    const cfg = {
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    };
    const res = await listGoogleCalendars(cfg);
    expect(res).toEqual([]);
  }, 15000);
});
