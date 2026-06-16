/**
 * /api/health の 200 / degraded / skipped シナリオ。
 *
 * - 動的 import('@prisma/client') を vi.mock で差し替え、SELECT 1 の成功・失敗・
 *   DATABASE_URL 未設定（skipped）の3ケースを検証する。
 * - route.ts はモジュールスコープでクライアントをキャッシュするので、
 *   ケースごとに `vi.resetModules()` で再ロードする。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prisma クライアントは ESM 動的 import で読まれるので vi.mock で差し替える。
// 各テスト直前に挙動を切り替えるために mutable な状態を 1 つだけ持つ。
let prismaBehavior: 'ok' | 'down' = 'ok';

vi.mock('@prisma/client', () => {
  class PrismaClient {
    async $queryRaw(): Promise<unknown> {
      if (prismaBehavior === 'down') {
        throw new Error('connection refused');
      }
      return [{ ok: 1 }];
    }
  }
  return { PrismaClient };
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DATABASE_URL;
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
});

async function callHealth(): Promise<{ status: number; body: Record<string, unknown> }> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — next の型は dev で解決される。テストはランタイム JSON のみ検証。
  const mod = await import('../../app/api/health/route.js');
  const res = await (mod as { GET: () => Promise<Response> }).GET();
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe('GET /api/health', () => {
  it('DB が応答すれば status=ok / db=ok / HTTP 200', async () => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abc1234567890';
    prismaBehavior = 'ok';
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBe('abc1234');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.ts).toBe('string');
  });

  it('DB が落ちていれば status=degraded / db=down / HTTP は 200 維持', async () => {
    process.env.DATABASE_URL = 'postgres://x';
    prismaBehavior = 'down';
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('down');
    expect(body.version).toBe('dev');
  });

  it('DATABASE_URL 未設定なら db=skipped で status=ok', async () => {
    prismaBehavior = 'ok';
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('skipped');
  });
});
