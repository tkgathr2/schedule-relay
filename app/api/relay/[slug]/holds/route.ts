/**
 * GET /api/relay/[slug]/holds — このリレーリンクの仮押さえ一覧を返す。
 * UIの「仮押さえ済み」セクションで表示する用途。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { summarizeHolds } from '@/service/relay-link';

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
    const link = await db().relayLink.findUnique({
      where: { slug },
      include: {
        holds: {
          orderBy: [{ stageOrder: 'asc' }, { startAt: 'asc' }],
        },
      },
    });
    if (!link) throw new ServiceError('NOT_FOUND', 'リンクが見つかりません');
    const holds = summarizeHolds(link.holds);
    return NextResponse.json({ slug: link.slug, holds });
  } catch (e) {
    return jsonError(e);
  }
}
