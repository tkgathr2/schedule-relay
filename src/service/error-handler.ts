/**
 * API ルート用の共通エラーハンドラ。
 *
 * - `withErrorHandler` は任意の Next.js Route Handler をラップし、
 *   throw された例外を統一形式の NextResponse に変換しつつ logger.error で記録する。
 * - `jsonError` は既存 `src/service/http.ts` の挙動と完全互換のレスポンスを返す。
 *   `withErrorHandler` を導入していない既存ルートは触らず、引き続き
 *   `src/service/http.ts` の `jsonError` を使い続けてよい。
 *
 * 注意: 既存の振る舞い（ServiceError → HTTP コード / code / message / details）は
 *       一切変えない。logger.error の差分だけが新規。
 */

import { NextResponse } from 'next/server';
import { isServiceError } from './errors.js';
import { logger } from './logger.js';

/**
 * エラーを統一形式の NextResponse に変換する。
 * - ServiceError は httpStatus / code を保持。
 * - その他は 500 / INTERNAL。
 */
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

type AnyHandler = (...args: unknown[]) => Promise<NextResponse> | NextResponse;

/**
 * Route Handler をラップして例外を統一形式に変換する。
 * - 第 1 引数（Request）から URL パスを抽出してログに添える。
 * - 既存の try/catch + jsonError と同じレスポンスを返すので、置き換えても挙動互換。
 */
export function withErrorHandler(
  handler: AnyHandler,
): (...args: unknown[]) => Promise<NextResponse> {
  return async (...args: unknown[]): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (e) {
      const path = extractPath(args);
      logger.error('api error', { error: e, path });
      return jsonError(e);
    }
  };
}

function extractPath(args: unknown[]): string | undefined {
  const req = args[0] as { url?: unknown } | undefined;
  if (req && typeof req.url === 'string') {
    try {
      return new URL(req.url).pathname;
    } catch {
      return req.url;
    }
  }
  return undefined;
}
