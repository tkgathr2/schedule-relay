/**
 * GET /api/relay/[slug]/ical
 * リレーリンクの RelayLinkHold を iCalendar (.ics) としてダウンロードする。
 * 各ステージ = 1 VEVENT。
 *
 * レスポンス:
 *  - Content-Type: text/calendar; charset=utf-8
 *  - Content-Disposition: attachment; filename="<slug>.ics"
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { buildIcs, type IcsEvent } from '@/service/ical';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    if (!slug) throw new ServiceError('VALIDATION', 'slug が不正です');

    const link = await db().relayLink.findUnique({
      where: { slug },
      include: {
        holds: { orderBy: [{ stageOrder: 'asc' }, { startAt: 'asc' }] },
      },
    });
    if (!link) throw new ServiceError('NOT_FOUND', 'リンクが見つかりません');

    const title = link.title || `リレー予約 ${slug}`;

    const events: IcsEvent[] = link.holds.map((h, idx) => ({
      uid: `relay-${slug}-${h.id}-${idx}@schedule-relay`,
      start: new Date(h.startAt),
      end: new Date(h.endAt),
      summary: `【${h.stageLabel}】${title}`,
      description: `ステージ ${h.stageOrder}: ${h.stageLabel}\n担当: ${h.ownerEmail}\nステータス: ${h.status}`,
    }));

    const ics = buildIcs(events, { calName: `${title}（リレー予約）` });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
