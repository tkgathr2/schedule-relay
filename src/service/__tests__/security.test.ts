/**
 * security.ts のユニットテスト：slug 検証 / IP 抽出 / セキュリティヘッダ存在チェック。
 * middleware のヘッダ付与は実 fetch で確認すると Next ランタイム起動が必要なので、
 * SECURITY_HEADERS の中身（=middleware が付与する集合）が要件を満たすかを直接検証する。
 */
import { describe, it, expect } from 'vitest';
import { ServiceError } from '../errors.js';
import {
  SLUG_RE,
  isValidSlug,
  assertValidSlug,
  clientIp,
  SECURITY_HEADERS,
} from '../security.js';

describe('slug validation', () => {
  it.each([
    'abcdefgh',
    'a-b_c-d_efg',
    'A1B2C3D4',
    'X'.repeat(32),
    'page-001-abc',
  ])('OK: %s', (s) => {
    expect(isValidSlug(s)).toBe(true);
    expect(() => assertValidSlug(s)).not.toThrow();
  });

  it.each([
    '',                     // 空
    'short',                // 7文字
    'X'.repeat(33),         // 33文字
    'has space',            // 空白
    'with/slash',           // 区切り
    'with.dot',             // ドット
    '日本語入りの長いslug',  // 非ASCII
    '<script>alert(1)',     // 危険文字
    null as unknown as string,
    undefined as unknown as string,
    42 as unknown as string,
  ])('NG: %p', (s) => {
    expect(isValidSlug(s)).toBe(false);
    expect(() => assertValidSlug(s)).toThrow(ServiceError);
  });

  it('正規表現が export されている', () => {
    expect(SLUG_RE.source).toContain('a-zA-Z0-9_-');
  });

  it('assertValidSlug の例外は VALIDATION', () => {
    try {
      assertValidSlug('');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError);
      expect((e as ServiceError).code).toBe('VALIDATION');
      expect((e as ServiceError).httpStatus).toBe(400);
    }
  });
});

describe('clientIp', () => {
  it('x-forwarded-for の先頭IPを返す', () => {
    const req = new Request('https://e.com/', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    });
    expect(clientIp(req)).toBe('203.0.113.10');
  });

  it('x-forwarded-for が空なら x-real-ip', () => {
    const req = new Request('https://e.com/', {
      headers: { 'x-real-ip': '198.51.100.5' },
    });
    expect(clientIp(req)).toBe('198.51.100.5');
  });

  it('cf-connecting-ip にもフォールバックする', () => {
    const req = new Request('https://e.com/', {
      headers: { 'cf-connecting-ip': '198.51.100.99' },
    });
    expect(clientIp(req)).toBe('198.51.100.99');
  });

  it('全部無いと "unknown"', () => {
    const req = new Request('https://e.com/');
    expect(clientIp(req)).toBe('unknown');
  });

  it('x-forwarded-for の余分な空白を取り除く', () => {
    const req = new Request('https://e.com/', {
      headers: { 'x-forwarded-for': '   1.2.3.4   ,5.6.7.8' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
});

describe('SECURITY_HEADERS', () => {
  it('必須セキュリティヘッダがすべて含まれる', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('geolocation=()');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('microphone=()');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()');
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toContain(
      'max-age=31536000',
    );
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toContain(
      'includeSubDomains',
    );
  });

  it('Cache-Control は SECURITY_HEADERS に含めない（既存 no-store 二重防御を上書きしないため）', () => {
    expect(SECURITY_HEADERS['Cache-Control']).toBeUndefined();
  });
});
