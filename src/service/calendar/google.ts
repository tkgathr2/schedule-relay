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
 * 確定時に主催者カレンダーへ予定を作成し、Google Meet の会議URLを発行する。
 * 失敗時は null を返す（degrade-safe：Meet無しでも確定は維持）。
 * 既存OAuthに `calendar.events` scope が無い場合や API エラー時も null。
 */
export interface CreateMeetEventInput {
  organizerCalendar?: string;
  summary: string;
  description?: string;
  startMs: number;
  endMs: number;
  attendees?: string[];
}

export interface CreateMeetEventResult {
  meetUrl: string | null;
  calendarEventLink: string | null;
  calendarEventId: string | null;
}

export async function createCalendarEventWithMeet(
  cfg: GoogleCalendarConfig,
  input: CreateMeetEventInput,
): Promise<CreateMeetEventResult | null> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    const requestId = `mt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await cal.events.insert({
      calendarId: input.organizerCalendar || 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'all',
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: new Date(input.startMs).toISOString() },
        end: { dateTime: new Date(input.endMs).toISOString() },
        attendees: (input.attendees ?? []).filter((e) => !!e).map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });
    const data = res.data;
    const entry = (data.conferenceData?.entryPoints ?? []).find((p) => p.entryPointType === 'video');
    return {
      meetUrl: entry?.uri ?? data.hangoutLink ?? null,
      calendarEventLink: data.htmlLink ?? null,
      calendarEventId: data.id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * カレンダー一覧（複数選択UI用）。失敗時は [] （degrade-safe）。
 * 「候補を自動抽出」UIで主催者の全カレンダーを名前付きで提示するために使う。
 */
export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

export async function listGoogleCalendars(
  cfg: GoogleCalendarConfig,
): Promise<GoogleCalendarSummary[]> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });
    const list = await cal.calendarList.list({ maxResults: 250, minAccessRole: 'reader' });
    const items = list.data.items ?? [];
    return items
      .filter((c): c is { id: string; summary?: string | null; backgroundColor?: string | null; primary?: boolean | null; accessRole?: string | null } => !!c.id)
      .map((c) => ({
        id: c.id,
        summary: c.summary ?? c.id,
        backgroundColor: c.backgroundColor ?? undefined,
        primary: c.primary ?? false,
        accessRole: c.accessRole ?? undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * [timeMinMs, timeMaxMs) の範囲で、対象カレンダーの busy 区間（UTC ms）を返す。
 * 失敗時は [] （degrade-safe）。
 * opts.calendarIds を渡すと cfg.calendarIds を上書き（候補抽出UIで個別選択するため）。
 */
export interface GoogleFreeBusyOptions {
  /** 上書き対象カレンダーID（空/未指定なら cfg.calendarIds を使う）。 */
  calendarIds?: string[];
}

export async function googleFreeBusy(
  cfg: GoogleCalendarConfig,
  timeMinMs: number,
  timeMaxMs: number,
  opts?: GoogleFreeBusyOptions,
): Promise<Interval[]> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    // 明示指定があればそちらを優先（候補抽出UIで複数選択した結果を直接渡す）。
    let ids = opts?.calendarIds && opts.calendarIds.length > 0 ? opts.calendarIds : cfg.calendarIds;
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

/**
 * カレンダーごとの busy 区間を分けて返す（色分け描画用）。
 * `googleFreeBusy` がマージするのに対し、こちらは `{[calendarId]: Interval[]}` を返す。
 * 失敗時は `{}`（degrade-safe）。
 */
export async function googleFreeBusyByCalendar(
  cfg: GoogleCalendarConfig,
  timeMinMs: number,
  timeMaxMs: number,
  calendarIds: string[],
): Promise<Record<string, Interval[]>> {
  try {
    if (!calendarIds || calendarIds.length === 0) return {};
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    let ids = calendarIds;
    if (ids.includes('auto')) {
      const list = await cal.calendarList.list({ maxResults: 250 });
      const all = (list.data.items ?? [])
        .map((c) => c.id)
        .filter((id): id is string => !!id);
      ids = all.length ? all : ['primary'];
    }

    const out: Record<string, Interval[]> = {};
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
        const arr: Interval[] = [];
        for (const b of cals[key]?.busy ?? []) {
          if (!b.start || !b.end) continue;
          const start = Date.parse(b.start);
          const end = Date.parse(b.end);
          if (!Number.isNaN(start) && !Number.isNaN(end) && start < end) arr.push({ start, end });
        }
        if (arr.length > 0) out[key] = mergeIntervals(arr);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 各カレンダーの events.list を叩いて、busy ブロックに重ねる summary（タイトル）を取得する。
 * freebusy には title が無いため、UI で「朝礼／移動／…」を出すためにこちらを併用する。
 * 失敗時は `{}`（degrade-safe）。
 */
export interface CalendarEventTitle {
  start: number;
  end: number;
  title: string;
}

export async function googleEventTitlesByCalendar(
  cfg: GoogleCalendarConfig,
  timeMinMs: number,
  timeMaxMs: number,
  calendarIds: string[],
): Promise<Record<string, CalendarEventTitle[]>> {
  try {
    if (!calendarIds || calendarIds.length === 0) return {};
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    let ids = calendarIds;
    if (ids.includes('auto')) {
      const list = await cal.calendarList.list({ maxResults: 250 });
      const all = (list.data.items ?? [])
        .map((c) => c.id)
        .filter((id): id is string => !!id);
      ids = all.length ? all : ['primary'];
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await cal.events.list({
            calendarId: id,
            timeMin: new Date(timeMinMs).toISOString(),
            timeMax: new Date(timeMaxMs).toISOString(),
            singleEvents: true,
            maxResults: 250,
            orderBy: 'startTime',
          });
          const items = res.data.items ?? [];
          const arr: CalendarEventTitle[] = [];
          for (const ev of items) {
            const sIso = ev.start?.dateTime ?? ev.start?.date;
            const eIso = ev.end?.dateTime ?? ev.end?.date;
            if (!sIso || !eIso) continue;
            const s = Date.parse(sIso);
            const e = Date.parse(eIso);
            if (Number.isNaN(s) || Number.isNaN(e) || s >= e) continue;
            arr.push({ start: s, end: e, title: ev.summary ?? '' });
          }
          return [id, arr] as const;
        } catch {
          return [id, [] as CalendarEventTitle[]] as const;
        }
      }),
    );
    const out: Record<string, CalendarEventTitle[]> = {};
    for (const [id, arr] of results) {
      if (arr.length > 0) out[id] = arr;
    }
    return out;
  } catch {
    return {};
  }
}
