/**
 * Next.js Middleware — 全レスポンスに標準セキュリティヘッダを付与する。
 * Cache-Control は触らない（既存「文字化け二重防御」/各 route 個別設定と整合）。
 *
 * 🚨 緊急セキュリティパッチ（2026-08-06）：Basic 認証ゲートを /admin 系だけでなく
 * **公開導線を除く全ページ・全 API** に拡張した。
 * Auth.js は未実装のまま本番稼働しており、/propose・/api/google/calendars 等から
 * 社長本人のカレンダーID・予定（取引先名・採用候補者名を含む）が無認証で読めていたため。
 * 本格的な Auth.js 実装までの暫定措置。
 *
 *  - ADMIN_USER / ADMIN_PASS が未設定なら 503（誤って無認証で晒さない fail-closed）。
 *  - NODE_ENV=test ではスキップ（vitest を煩わせない）。
 *  - 判定は default-deny：isPublicPath() の allowlist に無いパスは全て要認証。
 *    → 今後ルートを追加しても既定で保護される。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_HEADERS } from './src/service/security';
import { checkAdminAuth } from './src/service/admin';

/**
 * 認証不要で公開してよいパスか判定する（allowlist）。
 * 基準＝「相手に送るための公開URL」と「それが動くのに必要な最小限のAPI/静的アセット」だけ true。
 * 主催者（社長）専用の管理画面・API は全て false（＝要認証）。
 *
 * @param pathname URL パス
 * @param method   HTTP メソッド（HEAD は GET とみなす）
 */
export function isPublicPath(pathname: string, method: string): boolean {
  const m = method === 'HEAD' ? 'GET' : method;

  // ランディングページ（ダミーデータのみ・実データ無し）
  if (pathname === '/') return true;

  // PWA マニフェスト・アイコン等：公開ページの表示時にブラウザが必ず取りに来る。
  // 保護すると /b/ 等の公開ページで Basic 認証ダイアログが暴発する。
  if (
    pathname === '/manifest.webmanifest' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/icons/')
  ) {
    return true;
  }

  // ヘルスチェック（Railway / 外形監視）
  if (pathname === '/api/health') return true;

  // 空き時間リンクの公開予約ページ（相手に送るURL）と、その ical ダウンロード
  if (pathname === '/b' || pathname.startsWith('/b/')) return true;
  if (pathname.startsWith('/api/b/')) return true;

  // リレー型の進行ページ（担当者に送るURL）
  if (pathname === '/r' || pathname.startsWith('/r/')) return true;

  // リレー公開ページ／API。ただし「作成」系は主催者専用なので保護する。
  if (pathname === '/relay/new' || pathname.startsWith('/relay/new/')) return false;
  if (pathname.startsWith('/relay/')) return true;
  if (pathname === '/api/relay/create') return false;
  if (pathname.startsWith('/api/relay/')) return true;

  // 公開ページが予約フローで叩く必要のある API のみ、メソッドまで限定して開放する。
  //  - GET /api/pages/{slug}/availability : /b/{slug} の空き枠取得
  //  - POST /api/events                   : /b/{slug} の予約（イベント作成）
  //  - POST /api/events/{id}/holds|confirm: /b/{slug} の仮押さえ・確定
  //  - GET  /api/events/{id}/relay        : /r/{eventId} のステップ取得
  //  - POST /api/events/{id}/relay/advance: /r/{eventId} の枠確定
  // ※ GET /api/events（一覧）や POST /api/pages（作成）は開けない（情報漏洩・悪用防止）。
  if (m === 'GET' && /^\/api\/pages\/[^/]+\/availability$/.test(pathname)) return true;
  if (m === 'POST' && pathname === '/api/events') return true;
  if (m === 'POST' && /^\/api\/events\/[^/]+\/(holds|confirm)$/.test(pathname)) return true;
  if (m === 'GET' && /^\/api\/events\/[^/]+\/relay$/.test(pathname)) return true;
  if (m === 'POST' && /^\/api\/events\/[^/]+\/relay\/advance$/.test(pathname)) return true;

  return false;
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const pathname = req.nextUrl?.pathname ?? new URL(req.url).pathname;
  if (!isPublicPath(pathname, req.method ?? 'GET')) {
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
