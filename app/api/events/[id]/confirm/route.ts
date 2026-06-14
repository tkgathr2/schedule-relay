/**
 * POST /api/events/{id}/confirm — 確定（§14）。
 * body: { holdId, participantId, formAnswers?, now? }
 * カレンダー書込・会議URL発行は後続フェーズ（確定レコードのみ作成）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { confirmHold } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError, serverNow, slotToDto } from '@/service/http';

export async function POST(
  req: Request,
  _ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const holdId = typeof body.holdId === 'string' ? body.holdId : '';
    const participantId = typeof body.participantId === 'string' ? body.participantId : '';
    if (!holdId) throw new ServiceError('VALIDATION', 'holdId は必須です');
    if (!participantId) throw new ServiceError('VALIDATION', 'participantId は必須です');

    const now = serverNow(body.now);

    const repo = getRepository();
    const conf = await confirmHold(repo, holdId, participantId, body.formAnswers, now);
    return NextResponse.json(
      {
        confirmation: {
          id: conf.id,
          eventId: conf.eventId,
          participantId: conf.participantId,
          slot: slotToDto({ start: conf.start, end: conf.end }),
          confirmedAt: new Date(conf.confirmedAt).toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
