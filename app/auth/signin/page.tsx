/**
 * /auth/signin — ログイン画面。
 * middleware が未ログインの保護ページへのアクセスをここへ飛ばす（?callbackUrl=元のURL）。
 * Server Action で Auth.js の signIn('google') を叩くので、クライアント JS は不要。
 */
import { signIn } from '../../../auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * オープンリダイレクト対策：自サイト内の絶対パスだけを許可する。
 * `//evil.example` のようなプロトコル相対 URL は弾く。
 */
function safeCallbackUrl(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return '/links';
  if (!v.startsWith('/') || v.startsWith('//')) return '/links';
  return v;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const callbackUrl = safeCallbackUrl(sp.callbackUrl);

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
      <div
        style={{
          border: '1px solid #e3e8ef',
          borderRadius: 12,
          padding: '40px 28px',
          background: '#fff',
          boxShadow: '0 2px 12px rgba(16,24,40,.06)',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>📅</div>
        <h1 style={{ fontSize: 22, margin: '16px 0 6px' }}>スケ調くん</h1>
        <p style={{ color: '#667085', fontSize: 14, margin: '0 0 28px' }}>
          Google アカウントでログインしてください。
          <br />
          ログイン後は、あなた自身のカレンダーの空き状況をもとに調整できます。
        </p>

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 15,
              fontWeight: 600,
              color: '#fff',
              background: '#1e88e5',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Google でログイン
          </button>
        </form>

        <p style={{ color: '#98a2b3', fontSize: 12, marginTop: 20, marginBottom: 0 }}>
          許可されたアカウントのみログインできます。
        </p>
      </div>
    </main>
  );
}
