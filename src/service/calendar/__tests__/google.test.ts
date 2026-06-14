/**
 * Google Calendar 連携の degrade-safe 検証。
 * 認証情報が無い／API失敗時は null/[] を返し、確定/availability が壊れないこと。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createCalendarEventWithMeet, googleConfigFromEnv, googleFreeBusy } from '../google.js';

describe('googleConfigFromEnv', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('必須環境変数が無ければ null（連携オフ）', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    expect(googleConfigFromEnv()).toBeNull();
  });

  it('3点セットが揃えば設定を返す', () => {
    process.env.GOOGLE_CLIENT_ID = 'x';
    process.env.GOOGLE_CLIENT_SECRET = 'y';
    process.env.GOOGLE_REFRESH_TOKEN = 'z';
    const cfg = googleConfigFromEnv();
    expect(cfg).not.toBeNull();
    expect(cfg?.calendarIds.length).toBeGreaterThan(0);
  });
});

describe('createCalendarEventWithMeet (degrade-safe)', () => {
  it('不正なrefresh tokenでも例外で落ちずに null を返す', async () => {
    const cfg = {
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    };
    const res = await createCalendarEventWithMeet(cfg, {
      summary: 'test',
      startMs: Date.now() + 3600_000,
      endMs: Date.now() + 5400_000,
      attendees: ['guest@example.com'],
    });
    // 失敗時は確定を維持するため null（throwしない）
    expect(res).toBeNull();
  }, 15000);
});

describe('googleFreeBusy (degrade-safe)', () => {
  it('不正な認証情報でも例外で落ちずに [] を返す', async () => {
    const cfg = {
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    };
    const res = await googleFreeBusy(cfg, Date.now(), Date.now() + 3600_000);
    expect(res).toEqual([]);
  }, 15000);
});
