/**
 * リポジトリファクトリ。
 * DATABASE_URL が設定されていれば Prisma+PostgreSQL、なければ in-memory を返す。
 * 両実装を静的 import しておき、初期化はどちらか一方だけ行う。
 */
import { getMemoryRepository } from './memory.js';
import { getPrismaRepository } from './prisma.js';
import type { Repository } from './types.js';

export type { Repository };
export { getMemoryRepository } from './memory.js';

let _repo: Repository | undefined;

export function getRepository(): Repository {
  if (_repo) return _repo;
  _repo = process.env.DATABASE_URL ? getPrismaRepository() : getMemoryRepository();
  return _repo;
}
