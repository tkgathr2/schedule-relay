/**
 * 🔴 T6 リレー型 進行 API
 *
 *  POST /api/events/{id}/relay/advance
 *    body: { stepId, slot: {start, end} }
 *    -> { steps: RelayStepDto[] }   現ステップ→done、次の waiting→active
 *
 * converge では先頭が確定した枠と同一でないと CONFLICT_HOLD を返す（仕様 §5）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { advanceStep } from '@/service/relay';
import { ServiceError } from '@/service/errors';
import { jsonError, slotFromDto } from '@/service/http';

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
    const slot = slotFromDto(body.slot);
    if (!slot) throw new ServiceError('VALIDATION', 'slot.start / slot.end が必要です');

    const repo = getRepository();
    const steps = await advanceStep(repo, id, stepId, slot);
    return NextResponse.json({ steps });
  } catch (e) {
    return jsonError(e);
  }
}
