/**
 * POST /api/pages/{slug}/cancel — 予約ページを非アクティブにする（軽実装）。
 *   isActive=false。既に false でも 200。存在しなければ 404。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { assertValidSlug } from '@/service/security';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が必要です');
    assertValidSlug(slug);
    const repo = getRepository();
    const page = await repo.deactivatePageBySlug(slug);
    if (!page) throw new ServiceError('NOT_FOUND', `slug が見つかりません: ${slug}`);
    return NextResponse.json({ page });
  } catch (e) {
    return jsonError(e);
  }
}
