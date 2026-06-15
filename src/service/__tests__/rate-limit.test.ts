/**
 * rate-limit.ts のユニットテスト。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, rateLimit, _resetRateLimitForTests } from '../rate-limit.js';

beforeEach(() => {
  _resetRateLimitForTests();
});

describe('checkRateLimit (pure)', () => {
  it('最初の呼び出しは OK で remaining = limit-1', () => {
    const r = checkRateLimit('k', 3, 60, 1_000_000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(1_060_000);
  });

  it('上限まで OK、超えたら NG', () => {
    expect(checkRateLimit('k', 3, 60, 1_000_000).ok).toBe(true);
    expect(checkRateLimit('k', 3, 60, 1_000_001).ok).toBe(true);
    expect(checkRateLimit('k', 3, 60, 1_000_002).ok).toBe(true);
    const blocked = checkRateLimit('k', 3, 60, 1_000_003);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('別キー（別IP）は独立にカウントされる', () => {
    expect(checkRateLimit('a:1.1.1.1', 1, 60, 1_000_000).ok).toBe(true);
    expect(checkRateLimit('a:1.1.1.1', 1, 60, 1_000_001).ok).toBe(false);
    expect(checkRateLimit('a:2.2.2.2', 1, 60, 1_000_002).ok).toBe(true);
  });

  it('別ルートは独立にカウントされる', () => {
    expect(checkRateLimit('routeA:ip', 1, 60, 1_000_000).ok).toBe(true);
    expect(checkRateLimit('routeA:ip', 1, 60, 1_000_001).ok).toBe(false);
    expect(checkRateLimit('routeB:ip', 1, 60, 1_000_002).ok).toBe(true);
  });

  it('時間経過でウィンドウがリセットされる', () => {
    expect(checkRateLimit('k', 1, 60, 1_000_000).ok).toBe(true);
    expect(checkRateLimit('k', 1, 60, 1_001_000).ok).toBe(false);
    // 60s 経過後
    const r = checkRateLimit('k', 1, 60, 1_060_001);
    expect(r.ok).toBe(true);
  });

  it('retryAfterSec は最低 1 秒（切り上げ）', () => {
    checkRateLimit('k', 1, 60, 1_000_000);
    const r = checkRateLimit('k', 1, 60, 1_059_500); // 残り 500ms
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});

describe('rateLimit (Request → NextResponse | null)', () => {
  function makeReq(ip = '1.2.3.4'): Request {
    return new Request('https://example.com/x', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    });
  }

  it('上限以内は null を返す', () => {
    const r = rateLimit(makeReq('1.1.1.1'), 'rt', 2, 60);
    expect(r).toBeNull();
  });

  it('上限超過時は 429 と Retry-After ヘッダを返す', () => {
    expect(rateLimit(makeReq('5.5.5.5'), 'rt', 1, 60)).toBeNull();
    const blocked = rateLimit(makeReq('5.5.5.5'), 'rt', 1, 60);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(blocked!.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('429 レスポンスの body は RATE_LIMITED', async () => {
    rateLimit(makeReq('6.6.6.6'), 'rt2', 1, 60);
    const blocked = rateLimit(makeReq('6.6.6.6'), 'rt2', 1, 60)!;
    const json = (await blocked.json()) as { error: { code: string; details: { retryAfterSec: number } } };
    expect(json.error.code).toBe('RATE_LIMITED');
    expect(json.error.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('x-forwarded-for が無いと unknown としてカウント（共有グローバル枠）', () => {
    const req = new Request('https://example.com/x', { method: 'POST' });
    expect(rateLimit(req, 'rtX', 1, 60)).toBeNull();
    const req2 = new Request('https://example.com/x', { method: 'POST' });
    expect(rateLimit(req2, 'rtX', 1, 60)).not.toBeNull();
  });

  it('x-forwarded-for の先頭IPだけが採用される（プロキシチェーン対応）', () => {
    const req1 = new Request('https://example.com/x', {
      method: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' },
    });
    const req2 = new Request('https://example.com/x', {
      method: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.9, 192.168.0.1' },
    });
    expect(rateLimit(req1, 'rtFwd', 1, 60)).toBeNull();
    // 同一の先頭IP 9.9.9.9 → 2回目は超過
    expect(rateLimit(req2, 'rtFwd', 1, 60)).not.toBeNull();
  });
});
