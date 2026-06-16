/**
 * 管理ダッシュボード（/admin）用サービス層ヘルパ。
 *
 * 認証は middleware で済ませる前提（ADMIN_USER / ADMIN_PASS の Basic 認証）。
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

/** Basic 認証ヘッダから user/pass を取り出す。失敗時 null。 */
export function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, b64] = header.split(' ');
  if (scheme !== 'Basic' || !b64) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/**
 * Basic 認証の判定。
 *  - test 環境（NODE_ENV=test）は常に許可（テストで認証配線を煩わせない）。
 *  - ADMIN_USER / ADMIN_PASS のどちらかが未設定なら null（呼び出し側で 503 を返す）。
 *  - ヘッダ一致なら true、そうでなければ false。
 */
export type AdminAuthResult = 'ok' | 'unauthorized' | 'unconfigured';

export interface AdminAuthEnv {
  nodeEnv?: string;
  adminUser?: string;
  adminPass?: string;
}

export function checkAdminAuth(
  authHeader: string | null,
  env: AdminAuthEnv,
): AdminAuthResult {
  if (env.nodeEnv === 'test') return 'ok';
  const user = env.adminUser ?? '';
  const pass = env.adminPass ?? '';
  if (!user || !pass) return 'unconfigured';
  const parsed = parseBasicAuth(authHeader);
  if (!parsed) return 'unauthorized';
  if (parsed.user !== user || parsed.pass !== pass) return 'unauthorized';
  return 'ok';
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
