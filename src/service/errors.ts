/**
 * サービス層の決定論的エラー（仕様 §20）。
 * code は仕様 §20 の固定集合。httpStatus は API 層がそのまま返す。
 */

export type ServiceErrorCode =
  | 'CONFLICT_HOLD'
  | 'EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PAST_TIME'
  | 'GRID_VIOLATION'
  | 'MIN_NOTICE'
  | 'OUT_OF_HOURS'
  | 'CALENDAR_WRITE_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'VALIDATION';

const HTTP_STATUS: Record<ServiceErrorCode, number> = {
  CONFLICT_HOLD: 409,
  EXPIRED: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PAST_TIME: 400,
  GRID_VIOLATION: 400,
  MIN_NOTICE: 400,
  OUT_OF_HOURS: 400,
  CALENDAR_WRITE_FAILED: 502,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  VALIDATION: 400,
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ServiceErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'ServiceError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

/** unknown を ServiceError か否かで判定（API 層のハンドリング用）。 */
export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}
