/**
 * 認証ゲート（src/service/auth/gate.ts）のテスト。
 *
 * middleware.ts 本体は Auth.js の auth() ラッパで包まれており、実行には
 * AUTH_SECRET とセッション Cookie の実物が要るためユニットテストの対象外。
 * 判定を担う純関数 isPublicPath / decideGate をここで検証する
 * （＝「どのパスが無認証で通るか」「未ログインをどう弾くか」の回帰はここで止まる）。
 */
import { describe, it, expect } from 'vitest';
import { isPublicPath, decideGate, sessionStateOf } from '../gate.js';

describe('isPublicPath（公開/保護の境界）', () => {
  const PUBLIC: [string, string][] = [
    ['/', 'GET'],
    ['/manifest.webmanifest', 'GET'],
    ['/icons/icon-192.png', 'GET'],
    ['/api/health', 'GET'],
    ['/b/abc123', 'GET'],
    ['/api/b/abc123/ical', 'GET'],
    ['/r/evt_1', 'GET'],
    ['/relay/abc123', 'GET'],
    ['/api/relay/abc123', 'GET'],
    ['/api/relay/abc123/candidates', 'POST'],
    ['/api/relay/abc123/book', 'POST'],
    ['/api/relay/abc123/holds', 'GET'],
    ['/api/pages/abc123/availability', 'GET'],
    ['/api/events', 'POST'],
    ['/api/events/evt_1/holds', 'POST'],
    ['/api/events/evt_1/holds/hold_1', 'DELETE'],
    ['/api/events/evt_1/confirm', 'POST'],
    ['/api/events/evt_1/relay', 'GET'],
    ['/api/events/evt_1/relay/advance', 'POST'],
    // ログイン導線（保護すると「ログインするためにログインが要る」で詰む）
    ['/auth/signin', 'GET'],
    ['/auth/error', 'GET'],
    ['/api/auth/signin', 'GET'],
    ['/api/auth/signin/google', 'POST'],
    ['/api/auth/callback/google', 'GET'],
    ['/api/auth/session', 'GET'],
    ['/api/auth/csrf', 'GET'],
    ['/api/auth/providers', 'GET'],
    ['/api/auth/signout', 'POST'],
    // cron 用。middleware は通すが route 側で CRON_SECRET を検証する。
    ['/api/auth/refresh-keepalive', 'GET'],
  ];

  const PROTECTED: [string, string][] = [
    ['/propose', 'GET'],
    ['/create', 'GET'],
    ['/links', 'GET'],
    ['/calendar', 'GET'],
    ['/unconfirmed', 'GET'],
    ['/confirmed', 'GET'],
    ['/docs', 'GET'],
    ['/admin', 'GET'],
    ['/relay/new', 'GET'],
    ['/api/relay/create', 'POST'],
    ['/api/google/calendars', 'GET'],
    ['/api/availability/propose', 'POST'],
    ['/api/confirmations', 'GET'],
    ['/api/confirmations/csv', 'GET'],
    ['/api/pages', 'GET'],
    ['/api/pages', 'POST'],
    ['/api/pages/abc123/cancel', 'POST'],
    ['/api/events', 'GET'],
    ['/api/events/evt_1/relay/rollback', 'POST'],
    ['/api/events/evt_1/votes', 'POST'],
    ['/api/events/evt_1/votes/tally', 'GET'],
    ['/api/title/suggest', 'POST'],
    ['/api/title/history', 'GET'],
    ['/api/docs', 'GET'],
    ['/api/openapi', 'GET'],
    ['/api/admin/stats', 'GET'],
    // M1: /api/auth/** を丸ごと開けない。Auth.js の実エンドポイント以外は保護する。
    ['/api/auth/anything-else', 'GET'],
    ['/api/auth/admin-backdoor', 'POST'],
    ['/api/auth', 'GET'],
  ];

  it.each(PUBLIC)('公開: %s %s', (path, method) => {
    expect(isPublicPath(path, method)).toBe(true);
  });

  it.each(PROTECTED)('保護: %s %s', (path, method) => {
    expect(isPublicPath(path, method)).toBe(false);
  });

  it('未知のパスは default-deny（保護される）', () => {
    expect(isPublicPath('/some/new/page', 'GET')).toBe(false);
    expect(isPublicPath('/api/some/new/route', 'POST')).toBe(false);
  });

  it('HEAD は GET とみなす', () => {
    expect(isPublicPath('/api/pages/abc123/availability', 'HEAD')).toBe(true);
    expect(isPublicPath('/api/events', 'HEAD')).toBe(false);
  });
});

describe('sessionStateOf（許可リストの毎リクエスト再評価・H3）', () => {
  const LIST = 'atsuhiro@takagi.bz';

  it('未ログインは anonymous', () => {
    expect(sessionStateOf(null, LIST, false)).toBe('anonymous');
    expect(sessionStateOf('atsuhiro@takagi.bz', LIST, false)).toBe('anonymous');
  });

  it('許可リストに載っていれば active', () => {
    expect(sessionStateOf('atsuhiro@takagi.bz', LIST, true)).toBe('active');
  });

  it('セッションはあっても許可リストから外れていれば revoked', () => {
    // ALLOWED_EMAILS から削除した直後、既発行セッションが通り続けないこと
    expect(sessionStateOf('atsuhiro@takagi.bz', 'someone-else@example.com', true)).toBe('revoked');
    expect(sessionStateOf('atsuhiro@takagi.bz', undefined, true)).toBe('revoked');
  });
});

describe('decideGate（未ログイン・失効の弾き方）', () => {
  it('公開パスはセッション状態に関わらず通す', () => {
    expect(decideGate('/b/abc123', 'GET', 'anonymous')).toEqual({ kind: 'allow' });
    expect(decideGate('/api/health', 'GET', 'anonymous')).toEqual({ kind: 'allow' });
    expect(decideGate('/b/abc123', 'GET', 'revoked')).toEqual({ kind: 'allow' });
  });

  it('保護パスも active なら通す', () => {
    expect(decideGate('/propose', 'GET', 'active')).toEqual({ kind: 'allow' });
    expect(decideGate('/api/google/calendars', 'GET', 'active')).toEqual({ kind: 'allow' });
  });

  it('未ログインの保護 API は 401（JSON で返せるように）', () => {
    expect(decideGate('/api/google/calendars', 'GET', 'anonymous')).toEqual({ kind: 'unauthorized' });
    expect(decideGate('/api/availability/propose', 'POST', 'anonymous')).toEqual({ kind: 'unauthorized' });
  });

  it('未ログインの保護ページはログイン画面へ（元URLを callbackUrl で保持）', () => {
    expect(decideGate('/propose', 'GET', 'anonymous')).toEqual({
      kind: 'signin',
      callbackUrl: '/propose',
    });
    expect(decideGate('/links', 'GET', 'anonymous', '?tab=all')).toEqual({
      kind: 'signin',
      callbackUrl: '/links?tab=all',
    });
  });

  it('許可を外されたセッションは API なら 403', () => {
    expect(decideGate('/api/pages', 'GET', 'revoked')).toEqual({ kind: 'forbidden' });
  });

  it('許可を外されたセッションは画面ならアクセス拒否画面へ（ログイン画面だとループする）', () => {
    expect(decideGate('/links', 'GET', 'revoked')).toEqual({ kind: 'accessDenied' });
  });
});
