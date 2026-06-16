/**
 * Next.js Middleware — 全レスポンスに標準セキュリティヘッダを付与する。
 * Cache-Control は触らない（既存「文字化け二重防御」/各 route 個別設定と整合）。
 *
 * 追加：/admin と /api/admin への Basic 認証ゲート。
 *  - ADMIN_USER / ADMIN_PASS が未設定なら 503（誤って無認証で晒さない fail-closed）。
 *  - NODE_ENV=test ではスキップ（vitest を煩わせない）。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_HEADERS } from './src/service/security';
import { checkAdminAuth } from './src/service/admin';

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin');
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const pathname = req.nextUrl?.pathname ?? new URL(req.url).pathname;
  if (isAdminPath(pathname)) {
    const result = checkAdminAuth(req.headers.get('authorization'), {
      nodeEnv: process.env.NODE_ENV,
      adminUser: process.env.ADMIN_USER,
      adminPass: process.env.ADMIN_PASS,
    });
    if (result === 'unconfigured') {
      return applySecurityHeaders(
        new NextResponse(
          JSON.stringify({ error: 'ADMIN_USER / ADMIN_PASS が未設定です' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (result === 'unauthorized') {
      return applySecurityHeaders(
        new NextResponse('Authentication required', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="schedule-relay admin"',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }),
      );
    }
  }
  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // _next 内部・静的ファイル・favicon は除外（不要なヘッダ付与のオーバーヘッド回避）
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
