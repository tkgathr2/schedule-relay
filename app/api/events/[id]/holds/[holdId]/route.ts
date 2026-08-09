/**
 * DELETE /api/events/{id}/holds/{holdId} — 仮押さえを明示的に解放する。
 * body: { holderId }
 * 相手が別の枠を選び直した／選択を取り消したときに呼ぶ（枠の解放＋[調整中]予定の削除）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { releaseHeldSlot } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; holdId: string }> },
): Promise<NextResponse> {
  try {
    const { holdId } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const holderId = body && typeof body.holderId === 'string' ? body.holderId : '';
    if (!holderId) throw new ServiceError('VALIDATION', 'holderId は必須です');

    const repo = getRepository();
    await releaseHeldSlot(repo, holdId, holderId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
