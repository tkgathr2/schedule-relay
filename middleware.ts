/**
 * Next.js Middleware — 全レスポンスに標準セキュリティヘッダを付与する。
 * Cache-Control は触らない（既存「文字化け二重防御」/各 route 個別設定と整合）。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_HEADERS } from './src/service/security';

export function middleware(_req: NextRequest): NextResponse {
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  // _next 内部・静的ファイル・favicon は除外（不要なヘッダ付与のオーバーヘッド回避）
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
