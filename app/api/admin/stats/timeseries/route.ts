/**
 * GET /api/admin/stats/timeseries?days=30
 *   詳細統計画面（/admin/stats）用の時系列集計。
 *   - confirmations（予約確定）と holds（リレー仮押さえ）を日別に返す。
 *   - days は 1〜90 にクランプ（不正値はデフォルト 30）。
 *   - holds は Prisma 直叩き。DB 未接続環境では holds=[] に degrade。
 * 認証は middleware で済ませる前提（/api/admin/* は Basic 認証ゲート対象）。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getRepository } from '@/repo/index';
import { buildTimeseries } from '@/service/admin';
import { jsonError } from '@/service/http';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

function parseDays(raw: string | null): number {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_DAYS;
  if (n < MIN_DAYS) return MIN_DAYS;
  if (n > MAX_DAYS) return MAX_DAYS;
  return n;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get('days'));
    const now = Date.now();
    const fromMs = now - (days + 1) * DAY_MS; // 期間ぎりぎりの取りこぼし防止のため少し広めに。

    const repo = getRepository();
    const confirmations = await repo.listConfirmationsFiltered({ fromMs });

    // RelayLinkHold は Repository に乗っていないため Prisma を直接叩く。
    // degrade-safe: DB 接続失敗時は holds=[] で返す。
    let holds: { createdAt: Date }[] = [];
    try {
      holds = await db().relayLinkHold.findMany({
        where: { createdAt: { gte: new Date(fromMs) } },
        select: { createdAt: true },
      });
    } catch {
      // Prisma 未接続環境（テスト/プレビュー）。
    }

    const result = buildTimeseries({
      confirmations,
      holds,
      days,
      nowMs: now,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return jsonError(e);
  }
}
