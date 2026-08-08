/**
 * カレンダー連携のマルチテナント解決。
 *
 * 旧設計：環境変数 GOOGLE_REFRESH_TOKEN に固定の1本を持ち、誰がアクセスしても社長のカレンダーを読む。
 * 新設計：ログインしたユーザーごとに Auth.js が Account.refresh_token を保存し、
 *         そこからカレンダー資格情報を組み立てる（＝カレンダーの中身は一切 DB に保存しない）。
 *
 * 呼び分けの原則：
 *  - 主催者本人が操作している画面/API（/propose, /api/google/calendars 等）
 *      → googleConfigForCurrentUser()：ログイン中セッションのユーザーのトークンを使う。
 *  - 相手（未ログインのゲスト）が開く公開ページ由来の API
 *      （/api/pages/{slug}/availability, /api/b/{slug}/ical, /api/events/{id}/confirm …）
 *      → googleConfigForUserId(page.organizerId)：そのページを作った**主催者**のトークンを使う。
 *        ゲストにセッションは無いので、ここでセッションを見てはいけない。
 */
import type { GoogleCalendarConfig } from './google.js';
import { getDb } from '../db.js';

/** Account 行のうち、設定組み立てに使う最小フィールド。 */
export interface GoogleAccountLike {
  refresh_token: string | null;
  scope?: string | null;
}

/** OAuth クライアント資格情報（アプリ共通・env）。 */
export interface GoogleClientEnv {
  clientId?: string;
  clientSecret?: string;
  /** 既定の対象カレンダーID（カンマ区切り）。未設定なら 'auto'＝全カレンダー自動取得。 */
  calendarIds?: string;
}

/**
 * Account 行＋アプリの OAuth クライアント設定から GoogleCalendarConfig を組み立てる純関数。
 * refresh_token / clientId / clientSecret のいずれかが欠けたら null（連携オフ・degrade-safe）。
 */
export function buildGoogleConfig(
  account: GoogleAccountLike | null | undefined,
  env: GoogleClientEnv,
): GoogleCalendarConfig | null {
  const refreshToken = account?.refresh_token;
  if (!refreshToken) return null;
  const clientId = env.clientId;
  const clientSecret = env.clientSecret;
  if (!clientId || !clientSecret) return null;
  const ids = (env.calendarIds || 'auto')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { clientId, clientSecret, refreshToken, calendarIds: ids.length ? ids : ['auto'] };
}

/** env から OAuth クライアント資格情報を読む（Auth.js の AUTH_GOOGLE_* にもフォールバック）。 */
export function googleClientEnv(): GoogleClientEnv {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET,
    calendarIds: process.env.GOOGLE_CALENDAR_IDS,
  };
}

/** 指定ユーザーの Google Account 行を引く。未連携なら null。 */
export async function findGoogleAccount(userId: string): Promise<GoogleAccountLike | null> {
  if (!userId) return null;
  try {
    return await getDb().account.findFirst({
      where: { userId, provider: 'google' },
      select: { refresh_token: true, scope: true },
    });
  } catch {
    // DB 未接続（in-memory 運用・ローカル）でもアプリを落とさない。
    return null;
  }
}

/**
 * 指定ユーザー（= BookingPage.organizerId）のカレンダー資格情報。
 * 未ログインのゲストが叩く公開 API から、主催者のカレンダーを読むために使う。
 */
export async function googleConfigForUserId(
  userId: string | null | undefined,
): Promise<GoogleCalendarConfig | null> {
  if (!userId) return null;
  const account = await findGoogleAccount(userId);
  return buildGoogleConfig(account, googleClientEnv());
}

/**
 * ⚠️ メールアドレスからトークンを引く関数はあえて用意しない。
 * リクエスト由来の文字列（RelayLink.stages[].ownerEmail など）でトークンを解決すると、
 * 「他人のメールを書くだけで他人のカレンダーを読み書きできる」経路になる
 * （2026-08-08 セキュリティレビュー H2 で実際に指摘された）。
 * カレンダー資格情報は必ず「検証済みの User.id」から引くこと。
 */

/**
 * 現在ログイン中のユーザーの ID（未ログインなら null）。
 *
 * auth.ts は動的 import する：本ファイルはゲスト向けの公開 API からも読み込まれるため、
 * 静的 import にすると NextAuth + PrismaAdapter がそれら全てのモジュールグラフに乗る。
 * （ユニットテストから純関数だけを import できるようにする意味もある）
 */
export async function currentUserId(): Promise<string | null> {
  try {
    const { auth } = await import('../../../auth');
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** 現在ログイン中のユーザーのカレンダー資格情報。主催者本人の操作用。 */
export async function googleConfigForCurrentUser(): Promise<GoogleCalendarConfig | null> {
  const userId = await currentUserId();
  return googleConfigForUserId(userId);
}
