/**
 * PATCH /api/admin/links/[slug] — Link（BookingPage）の有効/無効切替。
 * body: { status: 'active' | 'disabled' }
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { assertValidSlug } from '@/service/security';

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

    const repo = getRepository();
    const updated = await repo.setPageActiveBySlug(slug, status === 'active');
    if (!updated) {
      throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    }
    return NextResponse.json(
      { slug: updated.slug, isActive: updated.isActive },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
