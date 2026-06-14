/**
 * POST /api/events/{id}/holds — 枠を Hold（§14・§12 ダブルブッキング防止）。
 * body: { slot: {start,end}, holderId, now? }
 */
import { NextResponse } from 'next/server';
import { getMemoryRepository } from '@/repo/memory';
import { holdSlot } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError, serverNow, slotFromDto, slotToDto } from '@/service/http';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const slot = slotFromDto(body.slot);
    if (!slot) throw new ServiceError('VALIDATION', 'slot.start / slot.end が必要です');
    const holderId = typeof body.holderId === 'string' ? body.holderId : '';
    if (!holderId) throw new ServiceError('VALIDATION', 'holderId は必須です');

    const now = serverNow(body.now);

    const repo = getMemoryRepository();
    const { hold, expiresAt } = await holdSlot(repo, id, slot, holderId, now);
    return NextResponse.json(
      {
        hold: { id: hold.id, eventId: hold.eventId, status: hold.status },
        slot: slotToDto(slot),
        expiresAt: new Date(expiresAt).toISOString(),
      },
      { status: 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
