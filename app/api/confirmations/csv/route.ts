/**
 * GET /api/confirmations/csv
 *   確定済の予定をCSV（BOM付きUTF-8・Excel互換）でダウンロード。
 *   ヘッダ：日時,タイトル,主催者
 *
 * 🔒 対象は**ログイン中ユーザーが主催者の確定のみ**。
 *    クエリの organizerId は無視する（2026-08-08 レビュー H1）。
 */
import { getRepository } from '@/repo/index';
import { jsonError } from '@/service/http';
import { requireSessionUserId } from '@/service/auth/session';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function fmtJst(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${yyyy}/${mm}/${dd}(${dow}) ${HH}:${MM}`;
}

function fmtRange(startMs: number, endMs: number): string {
  const d = new Date(endMs + JST_OFFSET_MS);
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fmtJst(startMs)}-${HH}:${MM}`;
}

function csvField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(): Promise<Response> {
  try {
    const organizerId = await requireSessionUserId();
    const repo = getRepository();
    const confs = await repo.listConfirmationsFiltered({ organizerId });

    const rows: string[] = ['日時,タイトル,主催者'];
    for (const c of confs) {
      const ev = await repo.getEvent(c.eventId);
      const page = ev ? await repo.getPageById(ev.pageId) : null;
      const settings = (page?.settings ?? {}) as { title?: string };
      const title = typeof settings.title === 'string' ? settings.title : '(無題)';
      const dt = fmtRange(c.start, c.end);
      rows.push(
        [csvField(dt), csvField(title), csvField(page?.organizerId ?? '')].join(','),
      );
    }
    const body = '﻿' + rows.join('\r\n') + '\r\n';
    const filename = `confirmations_${organizerId}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
