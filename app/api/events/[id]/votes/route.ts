/**
 * 🟦 T3 投票型 API
 *
 *  POST /api/events/{id}/votes        - 投票を記録（body: {candidateId, voterId}）
 *  GET  /api/events/{id}/votes/tally  - 集計を返す（別ファイル）
 *
 * 重複投票は no-op（既存があれば再利用）。Repository の @@unique 制約で物理防止。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { castVote } from '@/service/vote';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const candidateId = typeof body.candidateId === 'string' ? body.candidateId : '';
    const voterId = typeof body.voterId === 'string' ? body.voterId : '';
    if (!candidateId) throw new ServiceError('VALIDATION', 'candidateId は必須です');
    if (!voterId) throw new ServiceError('VALIDATION', 'voterId は必須です');

    const repo = getRepository();
    await castVote(repo, id, candidateId, voterId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const repo = getRepository();
    const cands = await repo.listCandidates(id);
    return NextResponse.json({
      candidates: cands.map((c) => ({
        candidateId: c.id,
        slot: {
          start: new Date(c.start).toISOString(),
          end: new Date(c.end).toISOString(),
        },
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
