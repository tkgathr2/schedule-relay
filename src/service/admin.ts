/**
 * 管理ダッシュボード（/admin）用サービス層ヘルパ。
 *
 * 認証は middleware で済ませる前提（Auth.js の Google OAuth セッション）。
 * 本ファイルは集計・整形の純関数中心。Prisma/Repository 呼び出しは API ルートが行い、
 * ここに渡す。テスト容易性のため副作用は持たない。
 */

/** /admin トップに出すサマリカード用 DTO。 */
export interface AdminStats {
  link: {
    total: number;
    active: number;
    confirmations: number;
  };
  relay: {
    total: number;
    active: number;
    holds: number;
  };
  confirmationsLast24h: number;
}

export interface AdminLinkRow {
  slug: string;
  title: string;
  type: string;
  organizerId: string;
  isActive: boolean;
  createdAt: string;
  confirmationCount: number;
}

export interface AdminRelayRow {
  slug: string;
  title: string;
  durationMinutes: number;
  stageCount: number;
  isActive: boolean;
  createdAt: string;
  holdCount: number;
}

/** /admin/links 一覧用 DTO 整形（page と確定件数Map から）。 */
export function formatLinkRows(
  pages: readonly {
    slug: string;
    organizerId: string;
    type: string;
    isActive: boolean;
    createdAt: number | Date;
    settings: unknown;
    id: string;
  }[],
  confirmationCountByPageId: ReadonlyMap<string, number>,
): AdminLinkRow[] {
  return pages.map((p) => {
    const settings =
      p.settings && typeof p.settings === 'object' ? (p.settings as Record<string, unknown>) : {};
    const title = typeof settings.title === 'string' ? settings.title : p.slug;
    return {
      slug: p.slug,
      title,
      type: p.type,
      organizerId: p.organizerId,
      isActive: p.isActive,
      createdAt: toIso(p.createdAt),
      confirmationCount: confirmationCountByPageId.get(p.id) ?? 0,
    };
  });
}

/** /admin/relay 一覧用 DTO 整形。 */
export function formatRelayRows(
  links: readonly {
    slug: string;
    title: string;
    durationMinutes: number;
    stages: unknown;
    status: string;
    createdAt: number | Date;
  }[],
  holdCountBySlug: ReadonlyMap<string, number>,
): AdminRelayRow[] {
  return links.map((l) => {
    const stageCount = Array.isArray(l.stages) ? l.stages.length : 0;
    return {
      slug: l.slug,
      title: l.title,
      durationMinutes: l.durationMinutes,
      stageCount,
      isActive: l.status === 'open',
      createdAt: toIso(l.createdAt),
      holdCount: holdCountBySlug.get(l.slug) ?? 0,
    };
  });
}

/** カード用 stats を合成する純関数。 */
export interface AdminStatsInput {
  linkPages: readonly { isActive: boolean }[];
  linkConfirmationsTotal: number;
  relayLinks: readonly { status: string }[];
  relayHoldsTotal: number;
  confirmationsLast24h: number;
}

export function buildStats(input: AdminStatsInput): AdminStats {
  return {
    link: {
      total: input.linkPages.length,
      active: input.linkPages.filter((p) => p.isActive).length,
      confirmations: input.linkConfirmationsTotal,
    },
    relay: {
      total: input.relayLinks.length,
      active: input.relayLinks.filter((l) => l.status === 'open').length,
      holds: input.relayHoldsTotal,
    },
    confirmationsLast24h: input.confirmationsLast24h,
  };
}

function toIso(v: number | Date): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

// ---------------- 時系列集計（/admin/stats 用） ----------------

/** 日別カウントの1点。date は YYYY-MM-DD（UTC基準）。 */
export interface TimeseriesPoint {
  date: string;
  count: number;
}

/** /api/admin/stats/timeseries のレスポンス DTO。 */
export interface TimeseriesResult {
  days: number;
  from: string;
  to: string;
  confirmations: TimeseriesPoint[];
  holds: TimeseriesPoint[];
}

/** buildTimeseries の入力。confirmations / holds は createdAt 相当（ms or Date）を持つ。 */
export interface TimeseriesInput {
  confirmations: readonly { confirmedAt: number | Date }[];
  holds: readonly { createdAt: number | Date }[];
  days: number;
  /** テスト用に「今」を差し込める。未指定なら Date.now()。 */
  nowMs?: number;
}

/** YYYY-MM-DD（UTC）に整形。 */
function toDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_MS_ADMIN = 24 * 60 * 60 * 1000;

/**
 * 過去 days 日間の日別カウント時系列を組み立てる純関数。
 *  - 期間外（古すぎる / 未来）はフィルタで除外。
 *  - 欠落日は count=0 で埋めるのでグラフが切れない。
 *  - 並びは date 昇順（古→新）。
 */
export function buildTimeseries(input: TimeseriesInput): TimeseriesResult {
  const days = Math.max(1, Math.floor(input.days));
  const now = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  // 期間の右端は「今日（UTC）の 23:59:59」相当 = 翌日0時の1ms前。
  // 左端は (days-1) 日前の 0:00。
  const todayKey = toDateKey(now);
  const todayStart = Date.UTC(
    Number(todayKey.slice(0, 4)),
    Number(todayKey.slice(5, 7)) - 1,
    Number(todayKey.slice(8, 10)),
  );
  const fromMs = todayStart - (days - 1) * DAY_MS_ADMIN;
  const toMs = todayStart + DAY_MS_ADMIN - 1;

  // 0埋め用の date キー一覧（昇順）。
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(toDateKey(fromMs + i * DAY_MS_ADMIN));
  }

  const aggregate = (records: readonly { [k: string]: unknown }[], field: string): TimeseriesPoint[] => {
    const map = new Map<string, number>();
    for (const k of keys) map.set(k, 0);
    for (const r of records) {
      const v = r[field];
      const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN;
      if (!Number.isFinite(ms)) continue;
      if (ms < fromMs || ms > toMs) continue;
      const k = toDateKey(ms);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return keys.map((date) => ({ date, count: map.get(date) ?? 0 }));
  };

  return {
    days,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    confirmations: aggregate(
      input.confirmations as readonly { [k: string]: unknown }[],
      'confirmedAt',
    ),
    holds: aggregate(input.holds as readonly { [k: string]: unknown }[], 'createdAt'),
  };
}
