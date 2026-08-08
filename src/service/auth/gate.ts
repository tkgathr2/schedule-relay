/**
 * 認証ゲートの判定ロジック（純関数のみ・副作用なし）。
 *
 * middleware.ts から切り出してある理由は2つ：
 *  1. middleware.ts は next-auth を import するため、ユニットテストから直接読み込めない。
 *     判定だけをここに置けば「どのパスが無認証で通るか」を軽量にテストできる。
 *  2. Edge ランタイムで動くので、Node 依存を一切持ち込まない。
 */

/**
 * 認証不要で公開してよいパスか判定する（allowlist）。
 * 基準＝「相手に送るための公開URL」と「それが動くのに必要な最小限のAPI/静的アセット」、
 * それに「ログインするために必ず無認証で到達できないといけない導線」だけ true。
 * 主催者（社長）専用の管理画面・API は全て false（＝要認証）。
 *
 * 判定は default-deny：ここに列挙されていないパスは全て要認証。
 * → 今後ルートを追加しても既定で保護される。
 *
 * @param pathname URL パス
 * @param method   HTTP メソッド（HEAD は GET とみなす）
 */
export function isPublicPath(pathname: string, method: string): boolean {
  const m = method === 'HEAD' ? 'GET' : method;

  // 🔑 ログイン導線そのもの。ここを保護すると「ログインするためにログインが要る」で詰む。
  //   /api/auth/**  : Auth.js のエンドポイント（signin/callback/session/csrf/signout）
  //   /auth/**      : 自前のログイン画面・アクセス拒否画面
  // ※ /api/auth/refresh-keepalive は cron 用で、route 側が CRON_SECRET を検証する。
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;

  // ランディングページ（ダミーデータのみ・実データ無し）
  if (pathname === '/') return true;

  // PWA マニフェスト・アイコン等：公開ページの表示時にブラウザが必ず取りに来る。
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

/** ゲート判定の結果。middleware がこれを NextResponse へ写像する。 */
export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'unauthorized' }
  | { kind: 'signin'; callbackUrl: string };

/**
 * 「このリクエストを通すか／どう弾くか」を決める。
 *
 * API（/api/**）は 401 JSON を返す（fetch 側でハンドリングできるように）。
 * 画面はログイン画面へリダイレクトし、ログイン後に元の URL へ戻す。
 */
export function decideGate(
  pathname: string,
  method: string,
  isAuthenticated: boolean,
  search = '',
): GateDecision {
  if (isPublicPath(pathname, method)) return { kind: 'allow' };
  if (isAuthenticated) return { kind: 'allow' };
  if (pathname.startsWith('/api/')) return { kind: 'unauthorized' };
  return { kind: 'signin', callbackUrl: `${pathname}${search}` };
}
