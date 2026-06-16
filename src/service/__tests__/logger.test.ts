/**
 * logger.ts: JSONL フォーマット / レベル閾値 / Error 展開のテスト。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, __testing__ } from '../logger.js';

describe('logger JSONL output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.unstubAllEnvs();
    if (origEnv !== undefined) vi.stubEnv('NODE_ENV', origEnv);
  });

  it('info を JSON1行で stdout に書く', () => {
    vi.stubEnv('NODE_ENV', 'development');
    logger.info('hello', { foo: 'bar' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.foo).toBe('bar');
    expect(typeof parsed.ts).toBe('string');
    // ISO8601 風
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('error は console.error に流す＋Error を {name,message,stack} に展開', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const e = new Error('boom');
    logger.error('api error', { error: e, path: '/x' });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('api error');
    expect(parsed.path).toBe('/x');
    expect(parsed.error).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof parsed.error.stack).toBe('string');
  });

  it('本番では debug は出力されない（INFO 以上）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.debug('quiet');
    logger.info('loud');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.msg).toBe('loud');
  });

  it('開発では debug も出る', () => {
    vi.stubEnv('NODE_ENV', 'development');
    logger.debug('hi');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('debug');
    expect(parsed.msg).toBe('hi');
  });
});

describe('logger helpers', () => {
  it('shouldEmit はレベル閾値で判定', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(__testing__.shouldEmit('debug')).toBe(false);
    expect(__testing__.shouldEmit('info')).toBe(true);
    expect(__testing__.shouldEmit('warn')).toBe(true);
    expect(__testing__.shouldEmit('error')).toBe(true);
    vi.unstubAllEnvs();
  });
});
