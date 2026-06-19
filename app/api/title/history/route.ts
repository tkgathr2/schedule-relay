/**
 * POST /api/title/history  — 使ったタイトルを保存（学習データ蓄積）
 * GET  /api/title/history  — 直近の履歴を返す
 */
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
let _prisma: PrismaClient | null = null;
function getClient() { if (!_prisma) _prisma = new PrismaClient(); return _prisma; }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { title, context } = (await req.json()) as { title: string; context?: string };
    if (!title?.trim()) return NextResponse.json({ ok: false }, { status: 400 });
    await getClient().titleHistory.create({ data: { title: title.trim(), context: context?.trim() || null } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('title/history POST error', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rows = await getClient().titleHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, context: true, createdAt: true },
    });
    return NextResponse.json({ history: rows });
  } catch {
    return NextResponse.json({ history: [] });
  }
}
