/**
 * 🔴 T6 リレー型 差し戻し API
 *
 *  POST /api/events/{id}/relay/rollback
 *    body: { stepId }
 *    -> { steps: RelayStepDto[] }   指定 done を active に戻し、以降を waiting に。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { rollbackStep } from '@/service/relay';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const stepId = typeof body.stepId === 'string' ? body.stepId : '';
    if (!stepId) throw new ServiceError('VALIDATION', 'stepId は必須です');

    const repo = getRepository();
    const steps = await rollbackStep(repo, id, stepId);
    return NextResponse.json({ steps });
  } catch (e) {
    return jsonError(e);
  }
}
