/**
 * POST /api/relay/create — RelayLink を作成して slug を返す。
 * body: {
 *   title, durationMinutes, stages: [{label, ownerEmail, calendarIds[]}],
 *   bufferMinutes?, maxGapDays?, startDate?, endDate?
 * }
 * 応答: { slug, id }
 *
 * 🔒 主催者専用（middleware で保護）。加えて本ルートで下記を検証する
 *    （2026-08-08 セキュリティレビュー H2）：
 *      - stages[].ownerEmail はログイン中本人のメールのみ許可（他人を担当者にできない）
 *      - calendarIds は本人の calendarList に実在するIDのみ許可
 *      - 作成者を createdByUserId に記録し、以降のカレンダー資格情報はここからのみ解決する
 */
import { NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { ServiceError } from '@/service/errors';
import { jsonError } from '@/service/http';
import {
  generateSlug,
  validateRelayStages,
  validateStagesOwnedBy,
  validateStageCalendarIds,
  type RelayStageDef,
} from '@/service/relay-link';
import { requireSessionUser } from '@/service/auth/session';
import { googleConfigForUserId } from '@/service/calendar/tenant';
import { listGoogleCalendars } from '@/service/calendar/google';

let _client: PrismaClient | undefined;
function db(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const me = await requireSessionUser();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ServiceError('VALIDATION', 'JSON ボディが必要です');

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw new ServiceError('VALIDATION', 'title が必要です');

    const duration = Number(body.durationMinutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 24 * 60) {
      throw new ServiceError('VALIDATION', 'durationMinutes が不正です');
    }

    const rawStages = Array.isArray(body.stages) ? body.stages : [];
    const stages: RelayStageDef[] = rawStages.map((s: unknown, i: number) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        order: typeof o.order === 'number' ? o.order : i + 1,
        label: typeof o.label === 'string' ? o.label : '',
        ownerEmail: typeof o.ownerEmail === 'string' ? o.ownerEmail : '',
        calendarIds: Array.isArray(o.calendarIds)
          ? (o.calendarIds.filter((x): x is string => typeof x === 'string'))
          : [],
      };
    });
    const stageErr = validateRelayStages(stages);
    if (stageErr) throw new ServiceError('VALIDATION', stageErr);

    // 🔒 担当者は本人のみ。他人のカレンダーを勝手に対象にさせない。
    const ownerErr = validateStagesOwnedBy(stages, me.email);
    if (ownerErr) throw new ServiceError('FORBIDDEN', ownerErr);

    // 🔒 calendarIds は本人が実際にアクセスできるカレンダーだけに限定する。
    // （'primary' 以外を1つでも指定するなら calendarList と突合する）
    const needsCalendarCheck = stages.some((s) =>
      s.calendarIds.some((id) => id.trim().toLowerCase() !== 'primary'),
    );
    if (needsCalendarCheck) {
      const cfg = await googleConfigForUserId(me.id);
      if (!cfg) {
        throw new ServiceError(
          'FORBIDDEN',
          'Googleカレンダーが未連携のため、primary 以外のカレンダーは指定できません',
        );
      }
      const allowed = (await listGoogleCalendars(cfg)).map((c) => c.id);
      if (allowed.length === 0) {
        throw new ServiceError('CALENDAR_WRITE_FAILED', 'カレンダー一覧を取得できませんでした');
      }
      const calErr = validateStageCalendarIds(stages, allowed);
      if (calErr) throw new ServiceError('FORBIDDEN', calErr);
    }

    const bufferMinutes =
      typeof body.bufferMinutes === 'number' && Number.isFinite(body.bufferMinutes)
        ? Math.max(0, Math.floor(body.bufferMinutes))
        : 15;
    const maxGapDays =
      typeof body.maxGapDays === 'number' && Number.isFinite(body.maxGapDays)
        ? Math.max(1, Math.floor(body.maxGapDays))
        : 14;

    const startDate = parseDate(body.startDate);
    const endDate = parseDate(body.endDate);
    if (startDate === null) throw new ServiceError('VALIDATION', 'startDate が不正です');
    if (endDate === null) throw new ServiceError('VALIDATION', 'endDate が不正です');

    // 衝突しないスラッグを最大5回まで再試行
    let slug = generateSlug();
    let created: { id: string; slug: string } | null = null;
    for (let i = 0; i < 5; i++) {
      try {
        const row = await db().relayLink.create({
          data: {
            slug,
            title,
            // カレンダー資格情報の唯一の出どころ。stages[].ownerEmail は信頼しない。
            createdByUserId: me.id,
            durationMinutes: Math.floor(duration),
            stages: stages as unknown as Prisma.InputJsonValue,
            bufferMinutes,
            maxGapDays,
            startDate: startDate ?? null,
            endDate: endDate ?? null,
            status: 'open',
          },
          select: { id: true, slug: true },
        });
        created = row;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        // P2002 = unique violation。slug 衝突のみ再試行。
        if (msg.includes('P2002')) {
          slug = generateSlug();
          continue;
        }
        throw e;
      }
    }
    if (!created) throw new ServiceError('VALIDATION', 'slug 生成に失敗しました');

    return NextResponse.json({ slug: created.slug, id: created.id });
  } catch (e) {
    return jsonError(e);
  }
}
