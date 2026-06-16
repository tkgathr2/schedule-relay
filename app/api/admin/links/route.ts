/**
 * GET /api/admin/links — Link（BookingPage）一覧（admin用）。
 * isActive=false も含めた全件を createdAt 降順で返す。各ページの確定件数も付与。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { formatLinkRows } from '@/service/admin';
import { jsonError } from '@/service/http';

export async function GET(): Promise<NextResponse> {
  try {
    const repo = getRepository();
    const [pages, countMap] = await Promise.all([
      repo.listAllPages(),
      repo.countConfirmationsByPage(),
    ]);
    const rows = formatLinkRows(pages, countMap);
    return NextResponse.json(
      { links: rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
