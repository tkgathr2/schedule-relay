/**
 * POST /api/events — イベント作成（§14・冪等）。
 * header: Idempotency-Key（任意・推奨）
 * body: { slug }
 */
import { NextResponse } from 'next/server';
import { getMemoryRepository } from '@/repo/memory';
import { createEventForPage } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const slug = body && typeof body.slug === 'string' ? body.slug : '';
    if (!slug) throw new ServiceError('VALIDATION', 'slug は必須です');

    const idempotencyKey = req.headers.get('Idempotency-Key');
    const repo = getMemoryRepository();
    const { event, reused } = await createEventForPage(repo, slug, idempotencyKey);
    return NextResponse.json({ event, reused }, { status: reused ? 200 : 201 });
  } catch (e) {
    return jsonError(e);
  }
}
