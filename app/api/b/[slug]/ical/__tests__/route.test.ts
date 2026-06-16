/**
 * GET /api/b/[slug]/ical のテスト。
 *  - 404 (page 無し / slug 不正)
 *  - 200 時の Content-Type / Content-Disposition / VCALENDAR
 */
import { describe, it, expect } from 'vitest';
import { GET } from '../route';
import { getMemoryRepository } from '@/repo/memory';

let seedCounter = 0;

async function seedActivePage(): Promise<{ slug: string }> {
  const repo = getMemoryRepository();
  const tag = `${Date.now().toString(36)}${(++seedCounter).toString(36)}`;
  const slug = `ical${tag}`.padEnd(8, 'x').slice(0, 32);
  await repo.createPage({
    organizerId: `org-${tag}`,
    type: 'T1',
    slug,
    settings: { title: 'iCal用ページ' },
  });
  return { slug };
}

function makeReq(slug: string, query?: string): Request {
  const url = `http://localhost/api/b/${slug}/ical${query ? `?${query}` : ''}`;
  return new Request(url, { method: 'GET' });
}

describe('GET /api/b/[slug]/ical', () => {
  it('200: Content-Type / Content-Disposition が .ics ダウンロード形式', async () => {
    const { slug } = await seedActivePage();
    const res = await GET(makeReq(slug), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${slug}.ics"`);
  });

  it('200: 本文は VCALENDAR で始まり / 終わる', async () => {
    const { slug } = await seedActivePage();
    const res = await GET(makeReq(slug), { params: Promise.resolve({ slug }) });
    const body = await res.text();
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body.includes('END:VCALENDAR\r\n')).toBe(true);
    expect(body).toContain('VERSION:2.0');
  });

  it('404: 存在しない slug', async () => {
    const slug = 'nopagezz9999';
    const res = await GET(makeReq(slug), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(404);
  });

  it('400: 不正な slug は VALIDATION 扱い', async () => {
    const slug = 'bad';
    const res = await GET(makeReq(slug), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(400);
  });
});
