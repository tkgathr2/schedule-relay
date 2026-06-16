/**
 * OpenAPI 仕様書とそれを返すルートのテスト。
 *
 * 1) public/openapi.json の構造検証（パス・スキーマ・$ref）
 * 2) GET /api/openapi が valid な JSON を Cache-Control 付きで返すこと
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GET as openapiGET } from '../route';

const SPEC_PATH = path.resolve(process.cwd(), 'public', 'openapi.json');

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

function loadSpec(): OpenApiSpec {
  return JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as OpenApiSpec;
}

function collectRefs(node: unknown, acc: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, acc);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === '$ref' && typeof v === 'string') acc.add(v);
    else collectRefs(v, acc);
  }
}

function resolveRef(spec: OpenApiSpec, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let cur: unknown = spec;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

describe('public/openapi.json — structure', () => {
  const spec = loadSpec();

  it('openapi 3.x／info.title／info.version が揃う', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  it('期待する 16 エンドポイントが全て定義されている', () => {
    const expected: [string, string][] = [
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
    for (const [p, method] of expected) {
      const item = spec.paths[p];
      expect(item, `path missing: ${p}`).toBeDefined();
      expect(item![method], `operation missing: ${method.toUpperCase()} ${p}`).toBeDefined();
    }
  });

  it('全 $ref が解決可能（components 配下に存在する）', () => {
    const refs = new Set<string>();
    collectRefs(spec, refs);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolveRef(spec, ref), `unresolved ref: ${ref}`).toBeDefined();
    }
  });

  it('代表スキーマが components.schemas に存在する', () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of [
      'ErrorResponse',
      'Interval',
      'ProposeRequest',
      'ProposeResponse',
      'BookingPage',
      'CreatePageRequest',
      'AvailabilityResponse',
      'CreateRelayRequest',
      'RelayLink',
      'RelayCandidatesResponse',
      'BookRelayRequest',
      'BookRelayResponse',
      'AdminStats',
      'AdminLinkRow',
      'AdminRelayRow',
      'HealthResponse',
    ]) {
      expect(schemas[name], `schema missing: ${name}`).toBeDefined();
    }
  });

  it('admin 系オペレーションは basicAuth security を要求する', () => {
    const adminOps: [string, string][] = [
      ['/api/admin/stats', 'get'],
      ['/api/admin/links', 'get'],
      ['/api/admin/links/{slug}', 'patch'],
      ['/api/admin/relay-links', 'get'],
      ['/api/admin/relay-links/{slug}', 'patch'],
    ];
    for (const [p, m] of adminOps) {
      const op = spec.paths[p]?.[m] as { security?: unknown[] } | undefined;
      expect(op?.security, `${m.toUpperCase()} ${p} に security 指定がない`).toBeDefined();
      const sec = (op!.security as { basicAuth?: unknown }[])[0];
      expect(sec.basicAuth, `${m.toUpperCase()} ${p} は basicAuth を使うべき`).toBeDefined();
    }
    expect(spec.components?.securitySchemes?.basicAuth).toBeDefined();
  });

  it('slug 系パスは Slug パラメータを参照している', () => {
    const slugPaths = [
      '/api/pages/{slug}/availability',
      '/api/pages/{slug}/cancel',
      '/api/relay/{slug}',
      '/api/relay/{slug}/candidates',
      '/api/relay/{slug}/book',
      '/api/relay/{slug}/holds',
      '/api/admin/links/{slug}',
      '/api/admin/relay-links/{slug}',
    ];
    for (const p of slugPaths) {
      const item = spec.paths[p];
      const ops = Object.values(item ?? {});
      const hasSlug = ops.some((op) => {
        const params = (op as { parameters?: { $ref?: string; name?: string }[] }).parameters ?? [];
        return params.some(
          (param) =>
            param.$ref === '#/components/parameters/Slug' || param.name === 'slug',
        );
      });
      expect(hasSlug, `slug param missing on ${p}`).toBe(true);
    }
  });
});

describe('GET /api/openapi', () => {
  it('200 で valid な OpenAPI JSON を返す', async () => {
    const res = await openapiGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as OpenApiSpec;
    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths).length).toBeGreaterThan(10);
  });

  it('Cache-Control: public, max-age=300 を付与する', async () => {
    const res = await openapiGET();
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=300');
  });
});
