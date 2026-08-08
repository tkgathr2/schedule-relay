/**
 * ログイン許可リスト（誰がこのシステムにログインできるか）。
 *
 * 方式は「環境変数 ALLOWED_EMAILS（カンマ区切り）」を採用した。判断根拠：
 *  - 許可対象は当面「社長本人 1 名」で、増えても数名。DB テーブル＋管理 UI を作るほどの規模ではない。
 *  - DB フラグ方式だと「初回ログイン時は allowed=false で作られる → 誰かが DB を直接 UPDATE するまで
 *    誰もログインできない」という鶏卵問題が発生し、初回セットアップが詰む。
 *  - env 方式なら Railway の変数を1行足して再デプロイするだけで追加でき、マイグレーションも不要。
 *  - 判定が純関数になるのでユニットテストが容易（本ファイル）。
 * 将来 10 名を超えて権限管理が要るようになったら User.allowed 列へ移行する。
 */

/**
 * ALLOWED_EMAILS を正規化して配列にする。
 * カンマ区切り・前後空白・大文字小文字は無視する。
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * このメールアドレスがログインを許可されているか。
 *
 * fail-closed：ALLOWED_EMAILS が未設定なら誰も入れない（誤って全開放しない）。
 * これは middleware の default-deny と同じ思想。
 */
export function isAllowedEmail(email: string | null | undefined, raw: string | undefined): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails(raw);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
