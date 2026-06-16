/**
 * middleware.ts のテスト：
 * NextResponse.next() に SECURITY_HEADERS が全て付与されることを確認。
 * /admin・/api/admin の Basic 認証ゲートも検証。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { middleware } from '../../../middleware';
import { SECURITY_HEADERS } from '../security.js';
import type { NextRequest } from 'next/server';

function makeReq(url: string, headers?: Record<string, string>): NextRequest {
  return new Request(url, { method: 'GET', headers }) as unknown as NextRequest;
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

  it('非 admin パスは ADMIN_USER 未設定でも 200 で通る', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASS;
    const res = middleware(makeReq('https://schedule.takagi.bz/links'));
    expect(res.status).toBe(200);
  });
});
