/**
 * GET|POST /api/auth/refresh-keepalive — リフレッシュトークン失効防止バッチ。
 *
 * 【なぜ必要か（社内ノウハウの教訓）】
 * Google のリフレッシュトークンは「6ヶ月間一度も使われない」と自動失効する。
 * Auth.js は画面アクセス時にトークンを使うが、ユーザーが長期間ログインしないと
 * refresh_token が一度も使われないまま期限切れになり、ある日突然カレンダー連携が死ぬ。
 * → 月次 cron でここを叩き、全ユーザーの refresh_token を実際に使って生かし続ける。
 *
 * 認証：cron は当然ログインできないので、middleware の allowlist（/api/auth/**）を通す代わりに
 *       ここで `Authorization: Bearer <CRON_SECRET>` を検証する。CRON_SECRET 未設定なら 503（fail-closed）。
 *
 * 実際のスケジュール登録（月次タスク）は本実装の対象外。
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/service/db';
import { refreshGoogleAccessToken } from '@/service/calendar/google';
import { buildGoogleConfig, googleClientEnv } from '@/service/calendar/tenant';
import { checkCronAuth } from '@/service/auth/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<NextResponse> {
  const authResult = checkCronAuth(req.headers.get('authorization'), process.env.CRON_SECRET);
  if (authResult === 'unconfigured') {
    return NextResponse.json({ error: 'CRON_SECRET が未設定です' }, { status: 503 });
  }
  if (authResult === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = googleClientEnv();
  if (!env.clientId || !env.clientSecret) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / SECRET が未設定です' }, { status: 503 });
  }

  let accounts: { userId: string; refresh_token: string | null }[] = [];
  try {
    accounts = await getDb().account.findMany({
      where: { provider: 'google', NOT: { refresh_token: null } },
      select: { userId: true, refresh_token: true },
    });
  } catch {
    return NextResponse.json({ error: 'DB に接続できません' }, { status: 503 });
  }

  const results = await Promise.all(
    accounts.map(async (a) => {
      const cfg = buildGoogleConfig(a, env);
      const ok = cfg ? await refreshGoogleAccessToken(cfg) : false;
      return { userId: a.userId, ok };
    }),
  );

  const refreshed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: failed.length === 0,
    total: results.length,
    refreshed,
    // 失効したトークンは再ログインが必要。userId だけ返す（トークン本体は絶対に出さない）。
    failedUserIds: failed.map((r) => r.userId),
    ts: new Date().toISOString(),
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
