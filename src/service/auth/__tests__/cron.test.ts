/**
 * cron エンドポイント認証のテスト。
 * /api/auth/refresh-keepalive は middleware の allowlist（/api/auth/**）を通ってしまうので、
 * ここが唯一のゲート。緩むと誰でも叩けるようになるため fail-closed を固定する。
 */
import { describe, it, expect } from 'vitest';
import { checkCronAuth } from '../cron.js';

describe('checkCronAuth', () => {
  it('CRON_SECRET 未設定なら unconfigured（fail-closed）', () => {
    expect(checkCronAuth('Bearer whatever', undefined)).toBe('unconfigured');
    expect(checkCronAuth('Bearer whatever', '')).toBe('unconfigured');
  });

  it('ヘッダ無しは unauthorized', () => {
    expect(checkCronAuth(null, 's3cret')).toBe('unauthorized');
    expect(checkCronAuth('', 's3cret')).toBe('unauthorized');
  });

  it('Bearer 以外のスキームは unauthorized', () => {
    const b64 = Buffer.from('a:s3cret').toString('base64');
    expect(checkCronAuth(`Basic ${b64}`, 's3cret')).toBe('unauthorized');
  });

  it('トークン不一致は unauthorized', () => {
    expect(checkCronAuth('Bearer wrong', 's3cret')).toBe('unauthorized');
  });

  it('トークン一致は ok', () => {
    expect(checkCronAuth('Bearer s3cret', 's3cret')).toBe('ok');
  });
});
