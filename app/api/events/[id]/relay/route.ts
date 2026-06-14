/**
 * 🔴 T6 リレー型 ステップ作成・一覧 API
 *
 *  POST /api/events/{id}/relay
 *    body: { steps: [{order, assigneeId, subMode, deadline?}] }
 *    -> { steps: RelayStepDto[] }  先頭が active で生成。
 *
 *  GET  /api/events/{id}/relay
 *    -> { steps: RelayStepDto[] }
 */
import { NextResponse } from 'next/server';
import { getRepository } from '@/repo/index';
import { createRelay, listSteps } from '@/service/relay';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import type { CreateRelayStepInput } from '@/repo/types';
import type { RelaySubMode } from '@/domain/types';

const VALID_SUBMODES: ReadonlySet<RelaySubMode> = new Set(['converge', 'chained', 'independent']);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');
    if (!Array.isArray(body.steps)) {
      throw new ServiceError('VALIDATION', 'steps 配列が必要です');
    }

    const steps: CreateRelayStepInput[] = [];
    for (const raw of body.steps) {
      if (!raw || typeof raw !== 'object') {
        throw new ServiceError('VALIDATION', 'steps 要素はオブジェクトである必要があります');
      }
      const r = raw as Record<string, unknown>;
      const order = typeof r.order === 'number' ? r.order : NaN;
      const assigneeId = typeof r.assigneeId === 'string' ? r.assigneeId : '';
      const subMode = typeof r.subMode === 'string' ? (r.subMode as RelaySubMode) : 'converge';
      if (!Number.isFinite(order) || order < 0) {
        throw new ServiceError('VALIDATION', 'order は 0 以上の整数で必須です');
      }
      if (!assigneeId) throw new ServiceError('VALIDATION', 'assigneeId は必須です');
      if (!VALID_SUBMODES.has(subMode)) {
        throw new ServiceError('VALIDATION', `subMode が不正です: ${subMode}`);
      }
      const deadlineRaw = r.deadline;
      let deadline: number | null = null;
      if (typeof deadlineRaw === 'number' && Number.isFinite(deadlineRaw)) deadline = deadlineRaw;
      else if (typeof deadlineRaw === 'string') {
        const t = Date.parse(deadlineRaw);
        if (!Number.isNaN(t)) deadline = t;
      }
      steps.push({ order, assigneeId, subMode, deadline });
    }

    const repo = getRepository();
    const created = await createRelay(repo, id, steps);
    return NextResponse.json({ steps: created }, { status: 201 });
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
    const steps = await listSteps(repo, id);
    return NextResponse.json({ steps });
  } catch (e) {
    return jsonError(e);
  }
}
