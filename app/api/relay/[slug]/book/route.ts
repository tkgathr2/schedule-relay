/**
 * POST /api/relay/[slug]/book — 候補を仮押さえする。
 * body: { candidate: [{stage:1, start:ISO, end:ISO}, ...] }
 * 各ステージごとに（連携時は）Googleカレンダーに provisional ホールドイベントを作成し、
 * DB の RelayLinkHold に1行ずつ記録する。
 * 同一 (relayLinkId, stageOrder, startAt) は unique で dedup。
 */
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import { googleConfigFromEnv, createCalendarEventWithMeet } from '@/service/calendar/google';

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

function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const candidate = Array.isArray(body.candidate) ? body.candidate : [];
    if (candidate.length === 0) throw new ServiceError('VALIDATION', 'candidate が必要です');

    const link = await db().relayLink.findUnique({ where: { slug } });
    if (!link) throw new ServiceError('NOT_FOUND', 'リンクが見つかりません');
    if (link.status !== 'open') throw new ServiceError('CONFLICT_HOLD', 'リンクは既に閉じられています');

    const stages = parseStages(link.stages);
    if (stages.length !== candidate.length) {
      throw new ServiceError('VALIDATION', 'candidate のステージ数が一致しません');
    }

    // ステージごとに検証＋仮押さえ
    const cfg = googleConfigFromEnv();
    const created: {
      stageOrder: number;
      stageLabel: string;
      start: string;
      end: string;
      googleEventId: string | null;
      googleEventLink: string | null;
    }[] = [];

    // 入力候補を order昇順に並べ替え
    const sortedCand = [...candidate]
      .map((c): { stage: number; start: number; end: number } | null => {
        if (!c || typeof c !== 'object') return null;
        const o = c as Record<string, unknown>;
        const stage = typeof o.stage === 'number' ? o.stage : null;
        const start = parseTime(o.start);
        const end = parseTime(o.end);
        if (stage === null || start === null || end === null) return null;
        if (end <= start) return null;
        return { stage, start, end };
      })
      .filter((c): c is { stage: number; start: number; end: number } => c !== null)
      .sort((a, b) => a.stage - b.stage);

    if (sortedCand.length !== stages.length) {
      throw new ServiceError('VALIDATION', 'candidate の中身が不正です');
    }

    // 順序整合性チェック：前のend + bufferMs <= 次のstart
    const bufferMs = link.bufferMinutes * 60 * 1000;
    for (let i = 1; i < sortedCand.length; i++) {
      const prev = sortedCand[i - 1]!;
      const cur = sortedCand[i]!;
      if (prev.end + bufferMs > cur.start) {
        throw new ServiceError('VALIDATION', `ステージ${prev.stage}→${cur.stage} のバッファが不足`);
      }
    }
    // maxGap チェック
    const maxGapMs = link.maxGapDays * 24 * 60 * 60 * 1000;
    const firstStart = sortedCand[0]!.start;
    const lastStart = sortedCand[sortedCand.length - 1]!.start;
    if (lastStart - firstStart > maxGapMs) {
      throw new ServiceError('VALIDATION', 'maxGapDays を超えています');
    }

    // 各ステージを順番に予約
    for (const cand of sortedCand) {
      const stage = stages.find((s) => s.order === cand.stage);
      if (!stage) {
        throw new ServiceError('VALIDATION', `stage ${cand.stage} は存在しません`);
      }

      // Googleカレンダー予定作成（cfgがある場合のみ）。失敗時は null（degrade-safe）。
      let googleEventId: string | null = null;
      let googleEventLink: string | null = null;
      if (cfg && stage.calendarIds.length > 0) {
        const targetCal = stage.calendarIds[0] ?? 'primary';
        const ev = await createCalendarEventWithMeet(cfg, {
          organizerCalendar: targetCal,
          summary: `【仮押さえ】${link.title} - ${stage.label}`,
          description: `リレー型調整 ${slug}\nステージ: ${stage.label}\n担当: ${stage.ownerEmail}`,
          startMs: cand.start,
          endMs: cand.end,
          attendees: [stage.ownerEmail],
        });
        if (ev) {
          googleEventId = ev.calendarEventId;
          googleEventLink = ev.calendarEventLink;
        }
      }

      try {
        await db().relayLinkHold.create({
          data: {
            relayLinkId: link.id,
            stageOrder: cand.stage,
            stageLabel: stage.label,
            ownerEmail: stage.ownerEmail,
            startAt: new Date(cand.start),
            endAt: new Date(cand.end),
            googleEventId,
            status: 'provisional',
          },
        });
      } catch (e) {
        // dedup: 同一 (link, stage, start) は重複作成しない（ユニーク制約で弾く）。
        const msg = e instanceof Error ? e.message : '';
        if (!msg.includes('P2002')) throw e;
      }

      created.push({
        stageOrder: cand.stage,
        stageLabel: stage.label,
        start: new Date(cand.start).toISOString(),
        end: new Date(cand.end).toISOString(),
        googleEventId,
        googleEventLink,
      });
    }

    return NextResponse.json({ ok: true, holds: created });
  } catch (e) {
    return jsonError(e);
  }
}
