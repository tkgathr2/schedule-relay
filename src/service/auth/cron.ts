/**
 * cron（スケジュールタスク）から叩かれるエンドポイントの認証。
 *
 * cron はブラウザではないので Auth.js のセッションを持てない。
 * 代わりに共有シークレットを `Authorization: Bearer <CRON_SECRET>` で送らせる。
 */
export type CronAuthResult = 'ok' | 'unauthorized' | 'unconfigured';

/**
 * Bearer トークンを検証する。
 * CRON_SECRET が未設定なら 'unconfigured'（fail-closed：誤って全開放しない）。
 */
export function checkCronAuth(
  authHeader: string | null,
  secret: string | undefined,
): CronAuthResult {
  if (!secret) return 'unconfigured';
  if (!authHeader) return 'unauthorized';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return 'unauthorized';
  return token === secret ? 'ok' : 'unauthorized';
}
