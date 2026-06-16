/**
 * GET /api/admin/relay-links — RelayLink 一覧（admin用）。
 * 全件を createdAt 降順で返す。各リンクの仮押さえ件数も付与。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { formatRelayRows } from '@/service/admin';
import { jsonError } from '@/service/http';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function GET(): Promise<NextResponse> {
  try {
    let links: {
      slug: string;
      title: string;
      durationMinutes: number;
      stages: unknown;
      status: string;
      createdAt: Date;
    }[] = [];
    const holdCountBySlug = new Map<string, number>();
    try {
      const rows = await db().relayLink.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { holds: true } } },
      });
      links = rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        durationMinutes: r.durationMinutes,
        stages: r.stages,
        status: r.status,
        createdAt: r.createdAt,
      }));
      for (const r of rows) {
        holdCountBySlug.set(r.slug, r._count.holds);
      }
    } catch {
      // Prisma 未接続環境では空配列を返す（degrade-safe）。
    }
    return NextResponse.json(
      { links: formatRelayRows(links, holdCountBySlug) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
