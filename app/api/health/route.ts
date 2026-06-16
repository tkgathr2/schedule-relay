/**
 * GET /api/health — ヘルスチェック。
 *
 * レスポンス:
 *   {
 *     status: "ok" | "degraded",
 *     uptime: <秒>,
 *     db:     "ok" | "down" | "skipped",
 *     version: <git short hash or "dev">,
 *     ts:     <ISO>
 *   }
 *
 * - DB ping は `SELECT 1` を 1000ms timeout で実行。
 * - 失敗時は `db:"down"` で status="degraded"。HTTP は 200 を維持し
 *   外部監視ツール（Railway / UptimeRobot 等）の判定に委ねる。
 * - DATABASE_URL 未設定（in-memory モード）は `db:"skipped"` でも status="ok"。
 */

import { NextResponse } from 'next/server';
// 相対 import：Vitest は tsconfig の `paths` を解釈しないため、テストから直接読めるように
// 既存 app/manifest.ts と同じ書き方に揃える（next の `@/*` も同じファイルを指す）。
import { logger } from '../../../src/service/logger.js';

// Prisma クライアントはこのモジュール専用にローカル保持。
// 既存 `src/repo/prisma.ts` の内部 `_client` には触らない（責務分離・互換維持）。
let _prisma: unknown | null = null;
async function getPrisma(): Promise<{ $queryRaw: (q: TemplateStringsArray) => Promise<unknown> } | null> {
  if (!process.env.DATABASE_URL) return null;
  if (_prisma) return _prisma as { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> };
  try {
    // 動的 import：in-memory モード（@prisma/client 未生成）でも /api/health がクラッシュしないように。
    const mod = (await import('@prisma/client')) as { PrismaClient: new () => unknown };
    _prisma = new mod.PrismaClient();
    return _prisma as { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> };
  } catch (e) {
    logger.warn('health: prisma import failed', { error: e });
    return null;
  }
}

async function pingDb(timeoutMs: number): Promise<'ok' | 'down' | 'skipped'> {
  const client = await getPrisma();
  if (!client) return 'skipped';
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db ping timeout')), timeoutMs),
      ),
    ]);
    return 'ok';
  } catch (e) {
    logger.warn('health: db ping failed', { error: e });
    return 'down';
  }
}

const STARTED_AT_MS = Date.now();

export async function GET(): Promise<NextResponse> {
  const db = await pingDb(1000);
  const status: 'ok' | 'degraded' = db === 'down' ? 'degraded' : 'ok';
  const version =
    process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA.length > 0
      ? process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)
      : 'dev';
  const body = {
    status,
    uptime: Math.floor((Date.now() - STARTED_AT_MS) / 1000),
    db,
    version,
    ts: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: 200 });
}
