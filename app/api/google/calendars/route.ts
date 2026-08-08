/**
 * GET /api/google/calendars — **ログイン中の本人**のGoogleカレンダー一覧を返す（候補自動抽出UI用）。
 * 未連携/失敗時は { calendars: [] } で degrade-safe。
 */
import { NextResponse } from 'next/server';
import { listGoogleCalendars } from '@/service/calendar/google';
import { googleConfigForCurrentUser } from '@/service/calendar/tenant';
import { jsonError } from '@/service/http';
import { rateLimit } from '@/service/rate-limit';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    // Rate limit: 60 req / 60s / IP
    const blocked = rateLimit(req, 'google:calendars', 60, 60);
    if (blocked) return blocked;

    const cfg = await googleConfigForCurrentUser();
    if (!cfg) return NextResponse.json({ calendars: [] });
    const calendars = await listGoogleCalendars(cfg);
    return NextResponse.json({ calendars });
  } catch (e) {
    return jsonError(e);
  }
}
