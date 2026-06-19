import { NextResponse } from 'next/server';
import { googleConfigFromEnv, googleFreeBusy } from '../../../../service/calendar/google.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = googleConfigFromEnv();
  if (!cfg) {
    return NextResponse.json({ status: 'no-config', ok: false }, { status: 200 });
  }
  const now = Date.now();
  const busy = await googleFreeBusy(cfg, now, now + 60 * 60 * 1000, { calendarIds: ['primary'] });
  const ok = Array.isArray(busy);
  return NextResponse.json({ status: ok ? 'ok' : 'fail', ok, ts: new Date(now).toISOString() }, { status: ok ? 200 : 500 });
}
