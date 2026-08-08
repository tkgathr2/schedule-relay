/**
 * API ルートから「今ログインしているのは誰か」を取得するヘルパ。
 *
 * 【なぜこれが要るか（2026-08-08 セキュリティレビュー H1）】
 * 以前は organizerId をクエリ文字列やリクエストボディから受け取っていたため、
 * `?organizerId=` を書き換えるだけで他人の予約ページ・確定予定が読めた（Cross-tenant IDOR）。
 * さらに POST /api/pages では被害者の User.id を騙って予約ページを作成でき、
 * その公開 availability API 経由で被害者の Google カレンダーの freebusy まで漏れていた。
 *
 * 原則：**organizerId はクライアントから受け取らない。必ずサーバ側でセッションから引く。**
 * リクエストに organizerId が入っていても無視する。
 */
import { ServiceError } from '../errors.js';
import { isAllowedEmail } from './allowlist.js';

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * ログイン中ユーザーを返す。未ログインなら 401、許可リストから外されていれば 403。
 *
 * 許可リストをここでも再評価しているのは、セッションが長期間有効なため
 * 「ALLOWED_EMAILS から削除された人の古いセッション」が生き続けるのを防ぐため（H3 と同じ理由）。
 * middleware でも同じ判定をしているが、API を直接叩かれる経路のための二重の防御。
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const { auth } = await import('../../../auth');
  const session = await auth();
  const id = session?.user?.id;
  const email = session?.user?.email;
  if (!id || !email) {
    throw new ServiceError('UNAUTHORIZED', 'ログインが必要です');
  }
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAILS)) {
    throw new ServiceError('FORBIDDEN', 'このアカウントは利用を許可されていません');
  }
  return { id, email };
}

/** ログイン中ユーザーの id（= BookingPage.organizerId）だけが欲しい場合の糖衣。 */
export async function requireSessionUserId(): Promise<string> {
  return (await requireSessionUser()).id;
}
