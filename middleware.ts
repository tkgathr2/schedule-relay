/**
 * Next.js Middleware — 全レスポンスに標準セキュリティヘッダを付与し、
 * 公開導線を除く全ページ・全 API に **Auth.js のセッション認証**を要求する。
 *
 * 履歴：
 *  - 2026-08-06 緊急セキュリティパッチで Basic 認証（ADMIN_USER/ADMIN_PASS）を全面に張った暫定措置。
 *  - 本コミットで Auth.js (NextAuth v5 / Google OAuth) に一本化。Basic 認証は完全撤去。
 *
 * Edge 制約：middleware は Edge ランタイムで動くため Prisma を import できない。
 * そのため auth.config.ts（Adapter 抜きの Edge セーフ設定）だけを使い、
 * セッション戦略は JWT にしてある（詳細は auth.config.ts のコメント）。
 *
 * どのパスを通すかの判定は src/service/auth/gate.ts（純関数・テスト済み）に置いてある。
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { SECURITY_HEADERS } from './src/service/security';
import { decideGate } from './src/service/auth/gate';
import { authConfig } from './auth.config';

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const nextUrl = req.nextUrl ?? new URL(req.url);
  const decision = decideGate(
    nextUrl.pathname,
    req.method ?? 'GET',
    !!req.auth,
    nextUrl.search ?? '',
  );

  if (decision.kind === 'unauthorized') {
    return applySecurityHeaders(
      new NextResponse(JSON.stringify({ error: 'ログインが必要です', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (decision.kind === 'signin') {
    const url = new URL('/auth/signin', nextUrl.origin);
    url.searchParams.set('callbackUrl', decision.callbackUrl);
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return applySecurityHeaders(NextResponse.next());
});

export const config = {
  // _next 内部・静的ファイル・favicon は除外（不要なヘッダ付与のオーバーヘッド回避）
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
