/**
 * 構造化ログ（JSONL）。
 *
 * - stdout に 1 行 1 オブジェクトの JSON を出力する。
 * - フォーマット: { ts, level, msg, ...meta }
 * - 本番(`NODE_ENV==='production'`) は INFO 以上、それ以外は DEBUG 以上。
 * - meta 内の Error は `error: { name, message, stack }` に展開する。
 * - 他のサービス層モジュールには依存しない（循環防止）。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentMinLevel(): LogLevel {
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentMinLevel()];
}

function expandError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'NonError', message: String(err) };
}

function expandMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      out.error = expandError(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldEmit(level)) return;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...expandMeta(meta),
  };
  // 例外時も logger が落ちないように JSON.stringify を try/catch する。
  let line: string;
  try {
    line = JSON.stringify(payload);
  } catch {
    line = JSON.stringify({
      ts: payload.ts,
      level,
      msg,
      meta_error: 'unserializable',
    });
  }
  // 標準出力へ。Next.js / Railway は stdout を収集する。
  // eslint-disable-next-line no-console
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    emit('debug', msg, meta);
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    emit('info', msg, meta);
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    emit('warn', msg, meta);
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    emit('error', msg, meta);
  },
};

// テスト用にエクスポート（プロダクションコードから使わない）。
export const __testing__ = {
  shouldEmit,
  expandError,
  expandMeta,
  LEVEL_RANK,
};
