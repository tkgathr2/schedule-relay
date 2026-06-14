/**
 * Google カレンダー連携：freebusy（埋まっている時間）を取得して busy 区間にする。
 * これを liveAvailabilityForPage の externalBusy に渡すと、主催者の実予定が空き枠から自動で消える
 * （社長要望「僕のカレンダーと同期して」）。
 *
 * 認証は単一テナント（高木さん）想定：OAuth2 リフレッシュトークンを環境変数で持ち、
 * サーバ側で freebusy.query を叩く。資格情報が無い／失敗した場合は [] を返して degrade-safe
 * （カレンダー連携が無くても受付時間帯ベースの空きは出る）。
 */
import { google } from 'googleapis';
import { mergeIntervals } from '../../domain/grid.js';
import type { Interval } from '../../domain/types.js';

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** 対象カレンダーID（カンマ区切り）。既定は primary。 */
  calendarIds: string[];
}

/** 環境変数から設定を読む。未設定なら null（連携オフ）。 */
export function googleConfigFromEnv(): GoogleCalendarConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  // 'auto'（既定）＝主催者の全カレンダーを自動取得して freebusy 対象にする（Spir同様）。
  const ids = (process.env.GOOGLE_CALENDAR_IDS || 'auto')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { clientId, clientSecret, refreshToken, calendarIds: ids.length ? ids : ['auto'] };
}

/**
 * [timeMinMs, timeMaxMs) の範囲で、対象カレンダーの busy 区間（UTC ms）を返す。
 * 失敗時は [] （degrade-safe）。
 */
export async function googleFreeBusy(
  cfg: GoogleCalendarConfig,
  timeMinMs: number,
  timeMaxMs: number,
): Promise<Interval[]> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    // 'auto' なら全カレンダーを列挙して対象にする（主催者の予定を漏れなく busy にする）。
    let ids = cfg.calendarIds;
    if (ids.includes('auto')) {
      const list = await cal.calendarList.list({ maxResults: 250 });
      const all = (list.data.items ?? [])
        .map((c) => c.id)
        .filter((id): id is string => !!id);
      ids = all.length ? all : ['primary'];
    }

    // freebusy.query は1回あたり最大50カレンダー。分割して問い合わせる。
    const out: Interval[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await cal.freebusy.query({
        requestBody: {
          timeMin: new Date(timeMinMs).toISOString(),
          timeMax: new Date(timeMaxMs).toISOString(),
          items: chunk.map((id) => ({ id })),
        },
      });
      const cals = res.data.calendars ?? {};
      for (const key of Object.keys(cals)) {
        for (const b of cals[key]?.busy ?? []) {
          if (!b.start || !b.end) continue;
          const start = Date.parse(b.start);
          const end = Date.parse(b.end);
          if (!Number.isNaN(start) && !Number.isNaN(end) && start < end) out.push({ start, end });
        }
      }
    }
    return mergeIntervals(out);
  } catch {
    return [];
  }
}
