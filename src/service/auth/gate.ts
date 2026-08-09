/**
 * 認証ゲートの判定ロジック（純関数のみ・副作用なし）。
 *
 * middleware.ts から切り出してある理由は2つ：
 *  1. middleware.ts は next-auth を import するため、ユニットテストから直接読み込めない。
 *     判定だけをここに置けば「どのパスが無認証で通るか」を軽量にテストできる。
 *  2. Edge ランタイムで動くので、Node 依存を一切持ち込まない。
 */
import { isAllowedEmail } from './allowlist.js';

/**
 * Auth.js が実際に提供するエンドポイントだけにマッチさせる。
 * https://authjs.dev/reference/nextjs#custom-pages のルート一覧に対応。
 * providers 名は callback/<provider> のように後続セグメントを取るので (\/|$) で許す。
 */
const AUTHJS_ENDPOINT_RE =
  /^\/api\/auth\/(signin|signout|callback|session|csrf|providers|error|verify-request|webauthn-options)(\/|$)/;

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
  // ただし /api/auth/** を丸ごと開けると、将来 /api/auth/ 配下に足したルートが
  // 気づかないうちに無認証で公開される。Auth.js の実エンドポイントだけを明示列挙する。
  if (AUTHJS_ENDPOINT_RE.test(pathname)) return true;
  // cron 用。middleware は通すが、route 側が CRON_SECRET（Bearer）を検証する。
  if (pathname === '/api/auth/refresh-keepalive') return true;
  //   /auth/** : 自前のログイン画面・アクセス拒否画面
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
  if (m === 'DELETE' && /^\/api\/events\/[^/]+\/holds\/[^/]+$/.test(pathname)) return true;
  if (m === 'GET' && /^\/api\/events\/[^/]+\/relay$/.test(pathname)) return true;
  if (m === 'POST' && /^\/api\/events\/[^/]+\/relay\/advance$/.test(pathname)) return true;

  return false;
}

/**
 * リクエストのセッション状態。
 *  - anonymous : 未ログイン
 *  - revoked   : セッションは有効だが、ALLOWED_EMAILS から外されている
 *  - active    : ログイン済み、かつ現在も許可リストに載っている
 */
export type SessionState = 'anonymous' | 'revoked' | 'active';

/**
 * セッションのメールアドレスを **毎リクエスト** 許可リストと突き合わせて状態を判定する。
 *
 * 【なぜ毎回評価するのか（2026-08-08 レビュー H3）】
 * 許可リストはログイン時（signIn コールバック）にしか評価されない。
 * セッションは長期間有効なので、ALLOWED_EMAILS から誰かを削除しても
 * 既発行のセッションはそのまま通り続けてしまい、緊急時の締め出し手段が
 * AUTH_SECRET ローテーション（＝全員強制ログアウト）しか無くなる。
 * ここで毎回評価すれば、env を1行直して再デプロイするだけで即座に締め出せる。
 *
 * 純関数かつ env 参照だけなので Edge ランタイムでも動く。
 */
export function sessionStateOf(
  email: string | null | undefined,
  allowedEmails: string | undefined,
  isAuthenticated: boolean,
): SessionState {
  if (!isAuthenticated) return 'anonymous';
  return isAllowedEmail(email, allowedEmails) ? 'active' : 'revoked';
}

/** ゲート判定の結果。middleware がこれを NextResponse へ写像する。 */
export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'accessDenied' }
  | { kind: 'signin'; callbackUrl: string };

/**
 * 「このリクエストを通すか／どう弾くか」を決める。
 *
 * API（/api/**）は 401/403 JSON を返す（fetch 側でハンドリングできるように）。
 * 画面は、未ログインならログイン画面（ログイン後に元URLへ戻す）、
 * 許可を外された場合はアクセス拒否画面へ送る
 * （ログイン画面に送るとログインし直しても弾かれてループするため）。
 */
export function decideGate(
  pathname: string,
  method: string,
  state: SessionState,
  search = '',
): GateDecision {
  if (isPublicPath(pathname, method)) return { kind: 'allow' };
  if (state === 'active') return { kind: 'allow' };
  const isApi = pathname.startsWith('/api/');
  if (state === 'revoked') return isApi ? { kind: 'forbidden' } : { kind: 'accessDenied' };
  return isApi ? { kind: 'unauthorized' } : { kind: 'signin', callbackUrl: `${pathname}${search}` };
}
