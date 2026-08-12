/**
 * POST /api/events — イベント作成（§14・冪等）。
 * header: Idempotency-Key（任意・推奨）
 * body: { slug }
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { createEventForPage } from '@/service/booking';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { requireSessionUserId } from '@/service/auth/session';
import type { BookingPageRec, EventStatus } from '@/repo/types';

const VALID_STATUSES: EventStatus[] = [
  'draft',
  'open',
  'holding',
  'confirmed',
  'closed',
  'expired',
  'cancelled',
];

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('status') ?? '';
    let statuses: EventStatus[];
    if (raw) {
      statuses = raw
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0) as EventStatus[];
      for (const s of statuses) {
        if (!VALID_STATUSES.includes(s)) {
          throw new ServiceError('VALIDATION', `status が不正です: ${s}`);
        }
      }
    } else {
      // 既定＝未確定の調整（open/holding）
      statuses = ['open', 'holding'];
    }
    // 対象は**ログイン中ユーザーが主催者のイベントのみ**（H1と同種のテナント横断漏れ防止）。
    const organizerId = await requireSessionUserId();
    const repo = getRepository();
    const events = await repo.listEventsByStatus(statuses);
    // 関連 BookingPage を join（settings.title・duration_minutes 取り出し用）
    const pageMap = new Map<string, BookingPageRec>();
    for (const e of events) {
      if (!pageMap.has(e.pageId)) {
        const page = await repo.getPageById(e.pageId);
        if (page) pageMap.set(e.pageId, page);
      }
    }
    const enriched = events
      // 自分用の仮押さえ専用イベント（リンク発行時に候補全部へ張るもの・idempotencyKey="self:{pageId}"）は
      // 相手とのやり取りではないため「未確定の調整」一覧には出さない。
      .filter((e) => !e.idempotencyKey?.startsWith('self:'))
      .filter((e) => pageMap.get(e.pageId)?.organizerId === organizerId)
      .map((e) => ({
        ...e,
        page: pageMap.get(e.pageId) ?? null,
      }));
    return NextResponse.json({ events: enriched });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const slug = body && typeof body.slug === 'string' ? body.slug : '';
    if (!slug) throw new ServiceError('VALIDATION', 'slug は必須です');

    const idempotencyKey = req.headers.get('Idempotency-Key');
    const repo = getRepository();
    const { event, reused } = await createEventForPage(repo, slug, idempotencyKey);
    return NextResponse.json({ event, reused }, { status: reused ? 200 : 201 });
  } catch (e) {
    return jsonError(e);
  }
}
