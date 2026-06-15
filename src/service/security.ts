/**
 * セキュリティ共通ヘルパ：
 * - clientIp(req)        : X-Forwarded-For 等から接続元IPを取り出す（Railway越し対応）
 * - SLUG_RE              : 公開URLの slug 検証用正規表現
 * - assertValidSlug(s)   : slug を検証して不正なら ServiceError(400) を投げる
 * - SECURITY_HEADERS     : middleware が全レスポンスに付ける標準セキュリティヘッダ
 */
import { ServiceError } from './errors.js';

/** 公開URL用 slug：英数 + `_` + `-` のみ、8〜32 文字 */
export const SLUG_RE = /^[a-zA-Z0-9_-]{8,32}$/;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

export function assertValidSlug(slug: unknown): asserts slug is string {
  if (!isValidSlug(slug)) {
    throw new ServiceError(
      'VALIDATION',
      'slug は半角英数・ハイフン・アンダースコアの8〜32文字で指定してください',
    );
  }
}

/**
 * Railway/Vercel 等の reverse proxy 越しでも接続元IPを取り出す。
 * 優先度: x-forwarded-for（先頭）→ x-real-ip → cf-connecting-ip → 'unknown'
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = h.get('x-real-ip');
  if (xri && xri.trim()) return xri.trim();
  const cf = h.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();
  return 'unknown';
}

/**
 * 全レスポンスに付与する標準セキュリティヘッダ。
 * `Cache-Control: no-store` は既存「文字化け二重防御」を上書きしないため意図的に含めない
 * （個別 route 側で no-store を出していれば優先される）。
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
