/**
 * PrismaClient のプロセス内シングルトン。
 * Auth.js アダプタ／マルチテナントのトークン参照など、Repository 層を経由しない
 * 直接クエリはここのクライアントを共有する（dev の HMR で接続が増殖しないように global に保持）。
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __scheduleRelayPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.__scheduleRelayPrisma) {
    globalForPrisma.__scheduleRelayPrisma = new PrismaClient();
  }
  return globalForPrisma.__scheduleRelayPrisma;
}
