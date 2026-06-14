/**
 * GET /api/google/calendars — 主催者のGoogleカレンダー一覧を返す（候補自動抽出UI用）。
 * env未設定/失敗時は { calendars: [] } で degrade-safe。
 */
import { NextResponse } from 'next/server';
import { googleConfigFromEnv, listGoogleCalendars } from '@/service/calendar/google';
import { jsonError } from '@/service/http';

export async function GET(): Promise<NextResponse> {
  try {
    const cfg = googleConfigFromEnv();
    if (!cfg) return NextResponse.json({ calendars: [] });
    const calendars = await listGoogleCalendars(cfg);
    return NextResponse.json({ calendars });
  } catch (e) {
    return jsonError(e);
  }
}
