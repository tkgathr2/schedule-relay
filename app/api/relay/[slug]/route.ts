/**
 * GET /api/relay/[slug] — RelayLink の基本情報を返す（UIの初期描画用）。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が不正です');
    const row = await db().relayLink.findUnique({ where: { slug } });
    if (!row) throw new ServiceError('NOT_FOUND', 'リンクが見つかりません');
    return NextResponse.json({
      slug: row.slug,
      title: row.title,
      durationMinutes: row.durationMinutes,
      stages: row.stages,
      bufferMinutes: row.bufferMinutes,
      maxGapDays: row.maxGapDays,
      startDate: row.startDate?.toISOString() ?? null,
      endDate: row.endDate?.toISOString() ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}
