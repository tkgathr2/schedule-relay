/**
 * POST /api/events/{id}/confirm — 確定（§14）。
 * body: { holdId, participantId, formAnswers?, now? }
 * カレンダー書込・会議URL発行は後続フェーズ（確定レコードのみ作成）。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { confirmHold } from '@/service/booking';
import { createCalendarEventWithMeet, googleConfigFromEnv } from '@/service/calendar/google';
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

    // Google Meet URL 自動発行（degrade-safe：scope不足・API失敗でも確定は維持）
    let meetUrl: string | null = null;
    let calendarEventLink: string | null = null;
    try {
      const gcfg = googleConfigFromEnv();
      if (gcfg) {
        const event = await repo.getEvent(conf.eventId);
        const page = event ? await repo.getPageById(event.pageId) : null;
        const fa = (body.formAnswers && typeof body.formAnswers === 'object') ? body.formAnswers as Record<string, unknown> : {};
        const summary = (page && (page.settings as { title?: unknown } | null)?.title && typeof (page.settings as { title?: unknown }).title === 'string')
          ? String((page.settings as { title?: unknown }).title)
          : 'ご面談';
        const guestName = typeof fa.name === 'string' ? fa.name : '';
        const guestEmail = typeof fa.email === 'string' ? fa.email : '';
        const note = typeof fa.note === 'string' && fa.note.trim() ? `\n\n一言メモ:\n${fa.note}` : '';
        const meetRes = await createCalendarEventWithMeet(gcfg, {
          summary: guestName ? `${summary}（${guestName}様）` : summary,
          description: `参加者: ${guestName} <${guestEmail}>${note}\n\nスケジュール調整くん経由`,
          startMs: conf.start,
          endMs: conf.end,
          attendees: guestEmail ? [guestEmail] : [],
        });
        if (meetRes) {
          meetUrl = meetRes.meetUrl;
          calendarEventLink = meetRes.calendarEventLink;
        }
      }
    } catch { /* Meet失敗は無視（確定は成功） */ }

    return NextResponse.json(
      {
        confirmation: {
          id: conf.id,
          eventId: conf.eventId,
          participantId: conf.participantId,
          slot: slotToDto({ start: conf.start, end: conf.end }),
          confirmedAt: new Date(conf.confirmedAt).toISOString(),
        },
        meetUrl,
        calendarEventLink,
      },
      { status: 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
