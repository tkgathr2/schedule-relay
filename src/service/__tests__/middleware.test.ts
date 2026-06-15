/**
 * middleware.ts のテスト：
 * NextResponse.next() に SECURITY_HEADERS が全て付与されることを確認。
 */
import { describe, it, expect } from 'vitest';
import { middleware } from '../../../middleware';
import { SECURITY_HEADERS } from '../security.js';
import type { NextRequest } from 'next/server';

describe('middleware', () => {
  it('全レスポンスに SECURITY_HEADERS を付与する', () => {
    const req = new Request('https://schedule.takagi.bz/anything', {
      method: 'GET',
    }) as unknown as NextRequest;
    const res = middleware(req);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(k)).toBe(v);
    }
  });

  it('Cache-Control は touch しない（既存設定を上書きしない）', () => {
    const req = new Request('https://schedule.takagi.bz/anything') as unknown as NextRequest;
    const res = middleware(req);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
