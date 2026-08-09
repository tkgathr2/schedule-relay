/**
 * Google Calendar 連携の degrade-safe 検証。
 * 認証情報が無い／API失敗時は null/[] を返し、確定/availability が壊れないこと。
 * ※ 設定の組み立ては env 直読み（googleConfigFromEnv）から
 *    src/service/calendar/tenant.ts の buildGoogleConfig（ユーザー単位）へ移行済み。
 */
import { describe, it, expect } from 'vitest';
import {
  createCalendarEventWithMeet,
  createHoldPlaceholderEvent,
  deleteCalendarEvent,
  refreshGoogleAccessToken,
  googleFreeBusy,
  googleFreeBusyByCalendar,
  googleEventTitlesByCalendar,
} from '../google.js';

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

describe('googleFreeBusyByCalendar (degrade-safe)', () => {
  const cfg = {
    clientId: 'invalid',
    clientSecret: 'invalid',
    refreshToken: 'invalid-refresh',
    calendarIds: ['primary'],
  };

  it('calendarIds が空なら即 {} を返す（API を叩かない）', async () => {
    const res = await googleFreeBusyByCalendar(cfg, Date.now(), Date.now() + 3600_000, []);
    expect(res).toEqual({});
  });

  it('不正な認証情報でも例外で落ちずに {} を返す', async () => {
    const res = await googleFreeBusyByCalendar(
      cfg,
      Date.now(),
      Date.now() + 3600_000,
      ['primary'],
    );
    expect(res).toEqual({});
  }, 15000);
});

describe('googleEventTitlesByCalendar (degrade-safe)', () => {
  const cfg = {
    clientId: 'invalid',
    clientSecret: 'invalid',
    refreshToken: 'invalid-refresh',
    calendarIds: ['primary'],
  };

  it('calendarIds が空なら即 {} を返す', async () => {
    const res = await googleEventTitlesByCalendar(cfg, Date.now(), Date.now() + 3600_000, []);
    expect(res).toEqual({});
  });

  it('不正な認証情報でも例外で落ちずに {} を返す', async () => {
    const res = await googleEventTitlesByCalendar(
      cfg,
      Date.now(),
      Date.now() + 3600_000,
      ['primary'],
    );
    expect(res).toEqual({});
  }, 20000);
});

describe('createHoldPlaceholderEvent (degrade-safe)', () => {
  it('不正なrefresh tokenでも例外で落ちずに null を返す', async () => {
    const cfg = {
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    };
    const res = await createHoldPlaceholderEvent(cfg, {
      summary: '[調整中] test',
      startMs: Date.now() + 3600_000,
      endMs: Date.now() + 5400_000,
    });
    expect(res).toBeNull();
  }, 15000);
});

describe('deleteCalendarEvent (degrade-safe)', () => {
  it('不正な資格情報でも例外で落ちずに false を返す', async () => {
    const cfg = {
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    };
    const ok = await deleteCalendarEvent(cfg, 'nonexistent-event-id');
    expect(ok).toBe(false);
  }, 15000);
});

describe('refreshGoogleAccessToken (degrade-safe)', () => {
  it('不正な資格情報でも例外で落ちずに false を返す', async () => {
    const ok = await refreshGoogleAccessToken({
      clientId: 'invalid',
      clientSecret: 'invalid',
      refreshToken: 'invalid-refresh',
      calendarIds: ['primary'],
    });
    expect(ok).toBe(false);
  }, 20000);
});
