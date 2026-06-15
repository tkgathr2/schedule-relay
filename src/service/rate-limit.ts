/**
 * In-memory IP+route rate limiter.
 *
 * 単一インスタンス前提の素朴な固定ウィンドウ実装。Railway 単一インスタンス本番では
 * これで十分機能する。マルチインスタンス化したら upstash/Redis 等に差し替える。
 *
 * - キー: `${route}:${ip}`
 * - LRU 上限 5,000 件で爆発防止（古いキーから捨てる）
 * - 期限切れキーは hit 時に lazy purge する
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number; // 残ウィンドウ秒（ok=true でも next reset の目安として返す）
  resetAt: number; // epoch ms
}

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const MAX_KEYS = 5_000;

class LruMap<K, V> extends Map<K, V> {
  constructor(private readonly cap: number) {
    super();
  }
  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    if (this.size > this.cap) {
      const oldest = this.keys().next().value as K | undefined;
      if (oldest !== undefined) super.delete(oldest);
    }
    return this;
  }
  override get(key: K): V | undefined {
    const v = super.get(key);
    if (v !== undefined) {
      super.delete(key);
      super.set(key, v);
    }
    return v;
  }
}

const buckets = new LruMap<string, Bucket>(MAX_KEYS);

/** テスト用。状態をクリアする。 */
export function _resetRateLimitForTests(): void {
  buckets.clear();
}

/**
 * 固定ウィンドウでカウント。`limit` 回まで OK、超えたら NG。
 * @param key  例: `propose:1.2.3.4`
 * @param limit 上限回数（このウィンドウ内）
 * @param windowSec ウィンドウ秒数
 * @param now epoch ms（既定 Date.now()）
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): RateLimitResult {
  const windowMs = windowSec * 1000;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSec: windowSec, resetAt };
  }
  if (existing.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec, resetAt: existing.resetAt };
  }
  existing.count += 1;
  buckets.set(key, existing); // re-touch for LRU
  return {
    ok: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    resetAt: existing.resetAt,
  };
}

/**
 * 統一 API：超過時は 429 NextResponse を返し、OK なら null を返す。
 * 各 route handler の冒頭で `const blocked = await rateLimit(req, 'propose', 30, 60); if (blocked) return blocked;`
 * のように使う。
 */
import { NextResponse } from 'next/server';
import { clientIp } from './security.js';

export function rateLimit(
  req: Request,
  routeKey: string,
  limit: number,
  windowSec: number,
): NextResponse | null {
  const ip = clientIp(req);
  const res = checkRateLimit(`${routeKey}:${ip}`, limit, windowSec);
  if (res.ok) return null;
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
        details: { retryAfterSec: res.retryAfterSec },
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(res.retryAfterSec),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(res.resetAt / 1000)),
      },
    },
  );
}
