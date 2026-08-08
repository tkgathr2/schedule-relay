/**
 * /auth/error — ログイン失敗・アクセス拒否画面（画面遷移図 X-1）。
 * Auth.js が pages.error として使う。許可リスト外のアカウントでログインすると
 * signIn コールバックが false を返し、`?error=AccessDenied` 付きでここへ飛ぶ。
 */
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/** Auth.js が投げてくる error コード → 日本語の説明。 */
function describe(code: string): { title: string; body: string } {
  switch (code) {
    case 'AccessDenied':
      return {
        title: 'アクセス権がありません',
        body: 'このGoogleアカウントはスケ調くんの利用を許可されていません。別のアカウントでお試しいただくか、管理者に確認してください。',
      };
    case 'Configuration':
      return {
        title: 'ログイン設定に問題があります',
        body: 'サーバー側の認証設定が正しくありません。管理者に確認してください。',
      };
    case 'Verification':
      return {
        title: 'リンクの有効期限が切れています',
        body: 'ログインリンクが期限切れか、すでに使用済みです。もう一度ログインしてください。',
      };
    default:
      return {
        title: 'ログインできませんでした',
        body: '時間をおいてもう一度お試しください。解消しない場合は管理者に確認してください。',
      };
  }
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const { title, body } = describe(typeof raw === 'string' ? raw : '');

  return (
    <main style={{ maxWidth: 460, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
      <div
        style={{
          border: '1px solid #e3e8ef',
          borderRadius: 12,
          padding: '40px 28px',
          background: '#fff',
          boxShadow: '0 2px 12px rgba(16,24,40,.06)',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>🔒</div>
        <h1 style={{ fontSize: 20, margin: '16px 0 10px' }}>{title}</h1>
        <p style={{ color: '#667085', fontSize: 14, lineHeight: 1.7, margin: '0 0 28px' }}>{body}</p>
        <Link
          href="/auth/signin"
          style={{
            display: 'inline-block',
            padding: '11px 22px',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            background: '#1e88e5',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          ログイン画面に戻る
        </Link>
      </div>
    </main>
  );
}
