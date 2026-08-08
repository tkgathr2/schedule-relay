/**
 * POST /api/relay/[slug]/candidates — 順序付き連続候補を返す。
 * 各ステージの calendarIds をGoogle freebusy へ問い合わせ → enumerateRelayCandidates。
 * Google 未連携時は busy=[] で degrade-safe（営業時間ベースの理論候補）。
 *
 * body（任意・全て無くてもRelayLinkの設定で動く）:
 *   { maxCandidates?: number }
 * 応答: { candidates: [{ stages: [{order,label,start,end}] }], stage: [{order,label}], durationMinutes }
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { googleFreeBusy } from '@/service/calendar/google';
import { googleConfigForEmail } from '@/service/calendar/tenant';
import { computeRelayCandidates, type RelayStageDef } from '@/service/relay-link';
import type { Interval } from '@/domain/types';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

interface StoredStage {
  order: number;
  label: string;
  ownerEmail: string;
  calendarIds: string[];
}

function parseStages(raw: unknown): StoredStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s, i): StoredStage | null => {
      if (!s || typeof s !== 'object') return null;
      const o = s as Record<string, unknown>;
      const order = typeof o.order === 'number' ? o.order : i + 1;
      const label = typeof o.label === 'string' ? o.label : '';
      const ownerEmail = typeof o.ownerEmail === 'string' ? o.ownerEmail : '';
      const calendarIds = Array.isArray(o.calendarIds)
        ? o.calendarIds.filter((x): x is string => typeof x === 'string')
        : [];
      if (!label || !ownerEmail) return null;
      return { order, label, ownerEmail, calendarIds };
    })
    .filter((s): s is StoredStage => s !== null)
    .sort((a, b) => a.order - b.order);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const link = await db().relayLink.findUnique({ where: { slug } });
    if (!link) throw new ServiceError('NOT_FOUND', 'リンクが見つかりません');
    if (link.status !== 'open') throw new ServiceError('CONFLICT_HOLD', 'リンクは既に閉じられています');

    const stages = parseStages(link.stages);
    if (stages.length === 0) throw new ServiceError('VALIDATION', 'stages が不正です');

    const now = Date.now();
    const periodStart = link.startDate ? link.startDate.getTime() : now;
    const periodEnd = link.endDate
      ? link.endDate.getTime()
      : now + (link.maxGapDays + 7) * 24 * 60 * 60 * 1000;

    // Google busy 取得（ステージごとに並列）。
    // マルチテナント化により、固定の1本ではなく **各ステージ担当者(ownerEmail)本人**の
    // トークンで freebusy を引く。担当者が未ログイン＝トークン未取得なら busy=[]（degrade-safe）。
    const busyByStage = new Map<number, Interval[]>();
    await Promise.all(
      stages.map(async (s) => {
        if (s.calendarIds.length === 0) {
          busyByStage.set(s.order, []);
          return;
        }
        const cfg = await googleConfigForEmail(s.ownerEmail);
        if (!cfg) {
          busyByStage.set(s.order, []);
          return;
        }
        const busy = await googleFreeBusy(cfg, periodStart, periodEnd, {
          calendarIds: s.calendarIds,
        });
        busyByStage.set(s.order, busy);
      }),
    );

    const maxCandidates =
      typeof body.maxCandidates === 'number' && Number.isFinite(body.maxCandidates)
        ? Math.max(1, Math.min(50, Math.floor(body.maxCandidates)))
        : 12;

    const stageDefs: RelayStageDef[] = stages.map((s) => ({
      order: s.order,
      label: s.label,
      ownerEmail: s.ownerEmail,
      calendarIds: s.calendarIds,
    }));

    const candidates = computeRelayCandidates({
      stages: stageDefs,
      durationMinutes: link.durationMinutes,
      bufferMinutes: link.bufferMinutes,
      maxGapDays: link.maxGapDays,
      startDate: link.startDate?.getTime(),
      endDate: link.endDate?.getTime(),
      busyByStage,
      now,
      maxCandidates,
    });

    return NextResponse.json({
      candidates: candidates.map((c) => ({
        stages: c.stages.map((cs) => ({
          order: cs.order,
          label: cs.label,
          start: new Date(cs.start).toISOString(),
          end: new Date(cs.end).toISOString(),
        })),
      })),
      stages: stages.map((s) => ({ order: s.order, label: s.label, ownerEmail: s.ownerEmail })),
      durationMinutes: link.durationMinutes,
      bufferMinutes: link.bufferMinutes,
      maxGapDays: link.maxGapDays,
    });
  } catch (e) {
    return jsonError(e);
  }
}
