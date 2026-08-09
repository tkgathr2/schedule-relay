/**
 * Google カレンダー連携：freebusy（埋まっている時間）を取得して busy 区間にする。
 * これを liveAvailabilityForPage の externalBusy に渡すと、主催者の実予定が空き枠から自動で消える
 * （社長要望「僕のカレンダーと同期して」）。
 *
 * 認証はマルチテナント：GoogleCalendarConfig（リフレッシュトークン込み）は
 * src/service/calendar/tenant.ts が「ログイン中ユーザー」または「そのページの主催者」の
 * Account 行から組み立てて渡す。本ファイルは env を一切見ない純粋な API クライアント。
 * 資格情報が無い／失敗した場合は [] を返して degrade-safe
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

/**
 * リフレッシュトークンを実際に使ってアクセストークンを取り直す（成功なら true）。
 *
 * 目的は「トークンの取得」ではなく「トークンを使うこと」そのもの。
 * Google のリフレッシュトークンは **6ヶ月間一度も使われない**と自動的に失効するため、
 * ユーザーが長期間ログインしなくても月次で叩いて生かし続ける（/api/auth/refresh-keepalive）。
 *
 * 毎回新しい OAuth2 インスタンスを作る＝アクセストークンのキャッシュが無いので、
 * getAccessToken() は必ず Google のトークンエンドポイントへ往復する。
 */
export async function refreshGoogleAccessToken(cfg: GoogleCalendarConfig): Promise<boolean> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const res = await oauth2.getAccessToken();
    return typeof res?.token === 'string' && res.token.length > 0;
  } catch {
    return false;
  }
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
 * 仮押さえ（Hold）中、主催者カレンダーに一時的な「[調整中]」予定を作る。
 * 確定前の段階なので Meet URL は発行せず・相手にも通知しない（sendUpdates:'none'）。
 * 失敗時は null を返す（degrade-safe：Google未連携でも仮押さえ自体は成立する）。
 */
export interface CreateHoldPlaceholderInput {
  summary: string;
  description?: string;
  startMs: number;
  endMs: number;
}

export async function createHoldPlaceholderEvent(
  cfg: GoogleCalendarConfig,
  input: CreateHoldPlaceholderInput,
): Promise<string | null> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });
    const res = await cal.events.insert({
      calendarId: 'primary',
      sendUpdates: 'none',
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: new Date(input.startMs).toISOString() },
        end: { dateTime: new Date(input.endMs).toISOString() },
      },
    });
    return res.data.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 上記の仮予定、または確定予定を削除する（Hold失効・他候補破棄・確定後の仮予定掃除に使う）。
 * 失敗時は false（degrade-safe：削除できなくても呼び出し側の主処理は継続する）。
 */
export async function deleteCalendarEvent(
  cfg: GoogleCalendarConfig,
  eventId: string,
  calendarId = 'primary',
): Promise<boolean> {
  try {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });
    await cal.events.delete({ calendarId, eventId, sendUpdates: 'none' });
    return true;
  } catch {
    return false;
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
    // showHidden: true — Googleカレンダー側で「表示しない」設定にしたカレンダー
    // （「他のカレンダー」欄でチェックを外しているもの等）も一覧に含める。
    // 省略時は false になり、そうしたカレンダーが選択肢から消えて選べなくなる。
    //
    // minAccessRole は指定しない：'reader' を指定すると、他人から
    // 「空き時間の情報のみ」で共有されたカレンダー（accessRole=freeBusyReader）が
    // 一覧から消える。空き時間を知りたいだけのこのアプリでは freeBusyReader でも
    // 十分機能するため、フィルタせず全アクセスレベルを一覧に含める。
    const list = await cal.calendarList.list({ maxResults: 250, showHidden: true });
    const items = list.data.items ?? [];
    return items
      .filter((c): c is { id: string; summary?: string | null; summaryOverride?: string | null; backgroundColor?: string | null; primary?: boolean | null; accessRole?: string | null } => !!c.id)
      .map((c) => ({
        id: c.id,
        // summaryOverride：Googleカレンダー画面で本人がつけた表示名
        // （「久原さん会社」等）。未設定なら元のカレンダー名（メールアドレス等）。
        summary: c.summaryOverride ?? c.summary ?? c.id,
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
      // showHidden: true — listGoogleCalendars と同様、Google側で非表示設定のカレンダーも
      // 'auto' 展開（busy算出・タイトル取得）に含める。片方だけ付け忘れると「一覧では選べるのに
      // 空き算出には効かない」という気づきにくい不整合になる。
      const list = await cal.calendarList.list({ maxResults: 250, showHidden: true });
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
      // showHidden: true — listGoogleCalendars と同様、Google側で非表示設定のカレンダーも
      // 'auto' 展開（busy算出・タイトル取得）に含める。片方だけ付け忘れると「一覧では選べるのに
      // 空き算出には効かない」という気づきにくい不整合になる。
      const list = await cal.calendarList.list({ maxResults: 250, showHidden: true });
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
      // showHidden: true — listGoogleCalendars と同様、Google側で非表示設定のカレンダーも
      // 'auto' 展開（busy算出・タイトル取得）に含める。片方だけ付け忘れると「一覧では選べるのに
      // 空き算出には効かない」という気づきにくい不整合になる。
      const list = await cal.calendarList.list({ maxResults: 250, showHidden: true });
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
