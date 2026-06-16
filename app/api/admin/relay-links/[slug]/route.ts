/**
 * PATCH /api/admin/relay-links/[slug] — RelayLink の status 切替（open/closed）。
 * body: { status: 'active' | 'disabled' }
 *  - 'active'   → status='open'
 *  - 'disabled' → status='closed'
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { assertValidSlug } from '@/service/security';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    assertValidSlug(slug);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');
    const status = body.status;
    if (status !== 'active' && status !== 'disabled') {
      throw new ServiceError('VALIDATION', "status は 'active' または 'disabled' を指定してください");
    }
    const dbStatus = status === 'active' ? 'open' : 'closed';

    const existing = await db().relayLink.findUnique({ where: { slug } });
    if (!existing) {
      throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    }
    const updated = await db().relayLink.update({
      where: { slug },
      data: { status: dbStatus },
    });
    return NextResponse.json(
      { slug: updated.slug, status: updated.status, isActive: updated.status === 'open' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
