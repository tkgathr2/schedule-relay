/**
 * error-handler.ts: withErrorHandler / jsonError の ServiceError → HTTP 変換テスト。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { withErrorHandler, jsonError } from '../error-handler.js';
import { ServiceError } from '../errors.js';

beforeEach(() => {
  // logger が console.error を呼ぶのでテスト出力を黙らせる。
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function readJson(res: NextResponse): Promise<unknown> {
  return await res.json();
}

describe('jsonError', () => {
  it('ServiceError は httpStatus + code を保つ', async () => {
    const e = new ServiceError('CONFLICT_HOLD', 'holding', { slot: 'x' });
    const res = jsonError(e);
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: { code: string; message: string; details: unknown } };
    expect(body.error.code).toBe('CONFLICT_HOLD');
    expect(body.error.message).toBe('holding');
    expect(body.error.details).toEqual({ slot: 'x' });
  });

  it('未知のエラーは 500 / INTERNAL', async () => {
    const res = jsonError(new Error('whoops'));
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('whoops');
  });
});

describe('withErrorHandler', () => {
  it('正常系はハンドラ戻り値をそのまま返す', async () => {
    const wrapped = withErrorHandler(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const res = await wrapped(new Request('http://localhost/api/x'));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
  });

  it('ServiceError を投げると ServiceError 形式に変換', async () => {
    const wrapped = withErrorHandler(async () => {
      throw new ServiceError('VALIDATION', 'bad input');
    });
    const res = await wrapped(new Request('http://localhost/api/y'));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('bad input');
  });

  it('未知エラーは 500 / INTERNAL に変換', async () => {
    const wrapped = withErrorHandler(async () => {
      throw new Error('kaboom');
    });
    const res = await wrapped(new Request('http://localhost/api/z'));
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
  });
});
