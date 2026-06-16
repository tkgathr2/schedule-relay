/**
 * GET /api/openapi — OpenAPI 3.1 仕様書（JSON）を返す。
 * public/openapi.json を読み込んで返却。Cache-Control: public, max-age=300。
 *
 * middleware の admin gate 対象外（パスが /api/admin で始まらない）。
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../../src/service/logger.js';

let _cached: unknown | null = null;
let _cachedAt = 0;
const CACHE_MS = 60 * 1000;

async function loadSpec(): Promise<unknown> {
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_MS) return _cached;
  const specPath = path.join(process.cwd(), 'public', 'openapi.json');
  const raw = await readFile(specPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  _cached = parsed;
  _cachedAt = now;
  return parsed;
}

export async function GET(): Promise<NextResponse> {
  try {
    const spec = await loadSpec();
    return NextResponse.json(spec, {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    logger.warn('openapi: failed to load spec', { error: e });
    return NextResponse.json(
      { error: 'openapi.json を読み込めませんでした' },
      { status: 500 },
    );
  }
}
