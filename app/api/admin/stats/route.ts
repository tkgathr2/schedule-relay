/**
 * GET /api/admin/stats — 管理ダッシュボードのカード用集計。
 * 認証は middleware で済ませる前提（/api/admin/* は Basic 認証ゲート対象）。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getRepository } from '@/repo/index';
import { buildStats } from '@/service/admin';
import { jsonError } from '@/service/http';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  try {
    const repo = getRepository();
    const now = Date.now();

    const [linkPages, allConfirmations, last24h] = await Promise.all([
      repo.listAllPages(),
      repo.listConfirmationsFiltered({}),
      repo.listConfirmationsFiltered({ fromMs: now - DAY_MS }),
    ]);

    // RelayLink / RelayLinkHold は Repository に乗っていないため Prisma を直接叩く。
    // degrade-safe: DB 接続失敗時は relay 集計を 0 で返す。
    let relayLinks: { status: string }[] = [];
    let relayHoldsTotal = 0;
    try {
      const [links, holdCount] = await Promise.all([
        db().relayLink.findMany({ select: { status: true } }),
        db().relayLinkHold.count(),
      ]);
      relayLinks = links;
      relayHoldsTotal = holdCount;
    } catch {
      // Prisma 未接続環境（テスト/プレビュー）では relay は 0 件として返す。
    }

    const stats = buildStats({
      linkPages,
      linkConfirmationsTotal: allConfirmations.length,
      relayLinks,
      relayHoldsTotal,
      confirmationsLast24h: last24h.length,
    });

    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return jsonError(e);
  }
}
