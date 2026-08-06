/**
 * middleware.ts のテスト：
 * NextResponse.next() に SECURITY_HEADERS が全て付与されることを確認。
 * /admin・/api/admin の Basic 認証ゲートも検証。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { middleware, isPublicPath } from '../../../middleware';
import { SECURITY_HEADERS } from '../security.js';
import type { NextRequest } from 'next/server';

function makeReq(
  url: string,
  headers?: Record<string, string>,
  method = 'GET',
): NextRequest {
  return new Request(url, { method, headers }) as unknown as NextRequest;
}

describe('middleware', () => {
  it('全レスポンスに SECURITY_HEADERS を付与する', () => {
    const res = middleware(makeReq('https://schedule.takagi.bz/anything'));
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(k)).toBe(v);
    }
  });

  it('Cache-Control は touch しない（既存設定を上書きしない）', () => {
    const res = middleware(makeReq('https://schedule.takagi.bz/anything'));
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

describe('middleware /admin auth gate', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_USER = process.env.ADMIN_USER;
  const ORIGINAL_PASS = process.env.ADMIN_PASS;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV;
    process.env.ADMIN_USER = ORIGINAL_USER;
    process.env.ADMIN_PASS = ORIGINAL_PASS;
  });

  it('NODE_ENV=test では /admin もそのまま通る（テスト中はゲート無効）', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const res = middleware(makeReq('https://schedule.takagi.bz/admin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('production で ADMIN_USER/PASS 未設定なら /admin は 503（fail-closed）', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASS;
    const res = middleware(makeReq('https://schedule.takagi.bz/admin'));
    expect(res.status).toBe(503);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('production で認証ヘッダが無ければ /admin は 401 + WWW-Authenticate', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    const res = middleware(makeReq('https://schedule.takagi.bz/admin'));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('正しい Basic 認証ヘッダなら /api/admin/stats は通過する', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    const token = Buffer.from('alice:pw').toString('base64');
    const res = middleware(
      makeReq('https://schedule.takagi.bz/api/admin/stats', {
        authorization: `Basic ${token}`,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('公開パス（/b/{slug}）は ADMIN_USER 未設定でも 200 で通る', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASS;
    const res = middleware(makeReq('https://schedule.takagi.bz/b/abc123'));
    expect(res.status).toBe(200);
  });
});

describe('isPublicPath（公開/保護の境界）', () => {
  const PUBLIC: [string, string][] = [
    ['/', 'GET'],
    ['/manifest.webmanifest', 'GET'],
    ['/icons/icon-192.png', 'GET'],
    ['/api/health', 'GET'],
    ['/b/abc123', 'GET'],
    ['/api/b/abc123/ical', 'GET'],
    ['/r/evt_1', 'GET'],
    ['/relay/abc123', 'GET'],
    ['/api/relay/abc123', 'GET'],
    ['/api/relay/abc123/candidates', 'POST'],
    ['/api/relay/abc123/book', 'POST'],
    ['/api/relay/abc123/holds', 'GET'],
    ['/api/pages/abc123/availability', 'GET'],
    ['/api/events', 'POST'],
    ['/api/events/evt_1/holds', 'POST'],
    ['/api/events/evt_1/confirm', 'POST'],
    ['/api/events/evt_1/relay', 'GET'],
    ['/api/events/evt_1/relay/advance', 'POST'],
  ];

  const PROTECTED: [string, string][] = [
    ['/propose', 'GET'],
    ['/create', 'GET'],
    ['/links', 'GET'],
    ['/calendar', 'GET'],
    ['/unconfirmed', 'GET'],
    ['/confirmed', 'GET'],
    ['/docs', 'GET'],
    ['/admin', 'GET'],
    ['/relay/new', 'GET'],
    ['/api/relay/create', 'POST'],
    ['/api/google/calendars', 'GET'],
    ['/api/availability/propose', 'POST'],
    ['/api/confirmations', 'GET'],
    ['/api/confirmations/csv', 'GET'],
    ['/api/pages', 'GET'],
    ['/api/pages', 'POST'],
    ['/api/pages/abc123/cancel', 'POST'],
    ['/api/events', 'GET'],
    ['/api/events/evt_1/relay/rollback', 'POST'],
    ['/api/events/evt_1/votes', 'POST'],
    ['/api/events/evt_1/votes/tally', 'GET'],
    ['/api/title/suggest', 'POST'],
    ['/api/title/history', 'GET'],
    ['/api/auth/keepalive', 'GET'],
    ['/api/docs', 'GET'],
    ['/api/openapi', 'GET'],
    ['/api/admin/stats', 'GET'],
  ];

  it.each(PUBLIC)('公開: %s %s', (path, method) => {
    expect(isPublicPath(path, method)).toBe(true);
  });

  it.each(PROTECTED)('保護: %s %s', (path, method) => {
    expect(isPublicPath(path, method)).toBe(false);
  });

  it('未知のパスは default-deny（保護される）', () => {
    expect(isPublicPath('/some/new/page', 'GET')).toBe(false);
    expect(isPublicPath('/api/some/new/route', 'POST')).toBe(false);
  });

  it('HEAD は GET とみなす', () => {
    expect(isPublicPath('/api/pages/abc123/availability', 'HEAD')).toBe(true);
    expect(isPublicPath('/api/events', 'HEAD')).toBe(false);
  });
});

describe('middleware 全体ゲート（production）', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_USER = process.env.ADMIN_USER;
  const ORIGINAL_PASS = process.env.ADMIN_PASS;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV;
    process.env.ADMIN_USER = ORIGINAL_USER;
    process.env.ADMIN_PASS = ORIGINAL_PASS;
  });

  it('認証なしの /propose は 401（情報漏洩の塞ぎ）', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    const res = middleware(makeReq('https://schedule.takagi.bz/propose'));
    expect(res.status).toBe(401);
  });

  it('認証なしの /api/google/calendars は 401', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    const res = middleware(makeReq('https://schedule.takagi.bz/api/google/calendars'));
    expect(res.status).toBe(401);
  });

  it('正しい Basic 認証なら /propose は通過する', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    const token = Buffer.from('alice:pw').toString('base64');
    const res = middleware(
      makeReq('https://schedule.takagi.bz/propose', { authorization: `Basic ${token}` }),
    );
    expect(res.status).toBe(200);
  });

  it('公開ページ /b/{slug} は認証なしでも 200 のまま', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_USER = 'alice';
    process.env.ADMIN_PASS = 'pw';
    expect(middleware(makeReq('https://schedule.takagi.bz/b/abc123')).status).toBe(200);
    expect(middleware(makeReq('https://schedule.takagi.bz/relay/abc123')).status).toBe(200);
    expect(middleware(makeReq('https://schedule.takagi.bz/api/health')).status).toBe(200);
  });
});
