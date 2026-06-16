/**
 * scripts/build-openapi.mjs — public/openapi.json を検証する。
 *
 * 「自動生成」ではなく「手書き仕様の構造検証」を行うスクリプト。
 * - JSON が valid
 * - OpenAPI 3.1 必須フィールド（openapi, info, paths）が揃う
 * - すべての $ref が解決可能（components.schemas / responses / parameters）
 * - 期待する 16 エンドポイントが全て載っている
 *
 * Usage:
 *   node scripts/build-openapi.mjs
 * Exit code 1 で失敗（CI でも使える）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(__dirname, '..', 'public', 'openapi.json');

const EXPECTED_PATHS = [
  ['/api/availability/propose', 'post'],
  ['/api/google/calendars', 'get'],
  ['/api/pages', 'get'],
  ['/api/pages', 'post'],
  ['/api/pages/{slug}/availability', 'get'],
  ['/api/pages/{slug}/cancel', 'post'],
  ['/api/relay/create', 'post'],
  ['/api/relay/{slug}', 'get'],
  ['/api/relay/{slug}/candidates', 'post'],
  ['/api/relay/{slug}/book', 'post'],
  ['/api/relay/{slug}/holds', 'get'],
  ['/api/admin/stats', 'get'],
  ['/api/admin/links', 'get'],
  ['/api/admin/links/{slug}', 'patch'],
  ['/api/admin/relay-links', 'get'],
  ['/api/admin/relay-links/{slug}', 'patch'],
  ['/api/health', 'get'],
];

/** $ref を再帰的に集める */
function collectRefs(node, acc) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, acc);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') acc.add(v);
    else collectRefs(v, acc);
  }
}

/** "#/components/schemas/Foo" → spec.components.schemas.Foo */
function resolveRef(spec, ref) {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let cur = spec;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

async function main() {
  const raw = await readFile(SPEC_PATH, 'utf-8');
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    console.error('[FAIL] openapi.json が valid な JSON ではありません:', e.message);
    process.exit(1);
  }

  const errors = [];

  if (!spec.openapi || !String(spec.openapi).startsWith('3.')) {
    errors.push(`openapi フィールドが 3.x ではありません: ${spec.openapi}`);
  }
  if (!spec.info || !spec.info.title || !spec.info.version) {
    errors.push('info.title / info.version が必要です');
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    errors.push('paths が必要です');
  }

  if (spec.paths) {
    for (const [p, method] of EXPECTED_PATHS) {
      const item = spec.paths[p];
      if (!item) {
        errors.push(`path 未定義: ${p}`);
        continue;
      }
      if (!item[method]) {
        errors.push(`operation 未定義: ${method.toUpperCase()} ${p}`);
      }
    }
  }

  const refs = new Set();
  collectRefs(spec, refs);
  for (const ref of refs) {
    const target = resolveRef(spec, ref);
    if (target === undefined) {
      errors.push(`$ref 解決不能: ${ref}`);
    }
  }

  if (errors.length > 0) {
    console.error('[FAIL] openapi.json の検証に失敗しました:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  const pathCount = Object.keys(spec.paths).length;
  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  const refCount = refs.size;
  console.log(
    `[OK] openapi.json valid: paths=${pathCount} schemas=${schemaCount} refs=${refCount}`,
  );
}

main().catch((e) => {
  console.error('[FAIL] 想定外エラー:', e);
  process.exit(1);
});
