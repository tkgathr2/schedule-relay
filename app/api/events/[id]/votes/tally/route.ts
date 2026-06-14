/**
 * 🟦 T3 投票型 集計 API
 *
 *  GET /api/events/{id}/votes/tally
 *    -> {
 *         tally: [{candidateId, slot, count}],
 *         winner: {candidateId, slot, count} | null
 *       }
 *
 * winner はタイブレーク（得票数降順 → earliest_start → candidate.id 昇順）で一意決定。
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { pickWinner, tallyVotes } from '@/service/vote';
import { jsonError, slotToDto } from '@/service/http';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const repo = getRepository();
    const tally = await tallyVotes(repo, id);
    const winner = await pickWinner(repo, id);
    return NextResponse.json({
      tally: tally.map((t) => ({
        candidateId: t.candidateId,
        slot: slotToDto(t.slot),
        count: t.count,
      })),
      winner: winner
        ? { candidateId: winner.candidateId, slot: slotToDto(winner.slot), count: winner.count }
        : null,
    });
  } catch (e) {
    return jsonError(e);
  }
}
