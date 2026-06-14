/**
 * API 層の共通ヘルパ。ServiceError を仕様 §20 の JSON エラーへ整形する。
 */
import { NextResponse } from 'next/server';
import { isServiceError } from './errors.js';

export function jsonError(e: unknown): NextResponse {
  if (isServiceError(e)) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, details: e.details ?? null } },
      { status: e.httpStatus },
    );
  }
  const message = e instanceof Error ? e.message : 'internal error';
  return NextResponse.json({ error: { code: 'INTERNAL', message } }, { status: 500 });
}

/** Slot を JSON 入出力用に ISO 文字列で表現する。 */
export interface SlotDto {
  start: string;
  end: string;
}

export function slotToDto(slot: { start: number; end: number }): SlotDto {
  return { start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString() };
}

/**
 * 状態変更系（holds/confirm）のサーバ時刻を決める。
 * 本番ではクライアント供給の `now` を無視し、必ずサーバ時刻を使う
 * （§20 PAST_TIME / MIN_NOTICE / EXPIRED を時刻偽装で回避させないため）。
 * テスト/プレビューでは環境変数 SCHEDULE_ALLOW_TEST_CLOCK=1 のときのみ body.now を許可する。
 */
export function serverNow(bodyNow: unknown): number {
  if (process.env.SCHEDULE_ALLOW_TEST_CLOCK === '1') {
    if (typeof bodyNow === 'number' && Number.isFinite(bodyNow)) return bodyNow;
    if (typeof bodyNow === 'string') {
      const p = Date.parse(bodyNow);
      if (!Number.isNaN(p)) return p;
    }
  }
  return Date.now();
}

export function slotFromDto(dto: unknown): { start: number; end: number } | null {
  if (!dto || typeof dto !== 'object') return null;
  const o = dto as Record<string, unknown>;
  const s = typeof o.start === 'string' ? Date.parse(o.start) : typeof o.start === 'number' ? o.start : NaN;
  const e = typeof o.end === 'string' ? Date.parse(o.end) : typeof o.end === 'number' ? o.end : NaN;
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return { start: s, end: e };
}
