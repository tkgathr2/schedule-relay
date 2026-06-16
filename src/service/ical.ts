/**
 * 依存ゼロ・RFC 5545 最小実装の iCalendar (.ics) ビルダー。
 *
 * 用途：
 *  - 公開予約ページ（/b/[slug]）の空き枠を .ics 化（VEVENT × N）
 *  - リレーリンク（/relay/[slug]）の RelayLinkHold を .ics 化（各ステージ＝1イベント）
 *
 * 仕様：
 *  - VCALENDAR / VERSION:2.0 / PRODID / CALSCALE:GREGORIAN 必須
 *  - VEVENT 各回：UID / DTSTAMP / DTSTART / DTEND / SUMMARY（+ DESCRIPTION/LOCATION 任意）
 *  - DTSTART / DTEND / DTSTAMP は UTC 形式 `YYYYMMDDTHHMMSSZ`
 *  - 改行は CRLF（"\r\n"）
 *  - テキスト値（SUMMARY/DESCRIPTION/LOCATION）は RFC 5545 §3.3.11 に従いエスケープ：
 *      "\" → "\\"、";" → "\;"、"," → "\,"、改行 → "\n"
 */

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
}

export interface IcsOptions {
  /** カレンダー名（X-WR-CALNAME に書き出す。Apple/Google 等で表示される） */
  calName?: string;
}

const CRLF = '\r\n';
const PRODID = '-//Schedule Relay//schedule-relay//JP';

/** RFC 5545 §3.3.11 テキスト値のエスケープ。 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Date を UTC `YYYYMMDDTHHMMSSZ` に整形（DTSTART/DTEND/DTSTAMP 用）。 */
function toIcsDateUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${m}${day}T${h}${mi}${s}Z`;
}

/**
 * VCALENDAR を組み立てる。events が空でも有効な VCALENDAR（VEVENT 0 個）を返す。
 *
 * @param events VEVENT に展開する予定の配列
 * @param opts カレンダー名など
 * @returns RFC 5545 準拠の .ics 本文（CRLF 区切り）
 */
export function buildIcs(events: readonly IcsEvent[], opts?: IcsOptions): string {
  const dtstamp = toIcsDateUtc(new Date());
  const lines: string[] = [];

  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${PRODID}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  if (opts?.calName) {
    lines.push(`X-WR-CALNAME:${escapeText(opts.calName)}`);
  }

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toIcsDateUtc(ev.start)}`);
    lines.push(`DTEND:${toIcsDateUtc(ev.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description !== undefined && ev.description !== '') {
      lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    }
    if (ev.location !== undefined && ev.location !== '') {
      lines.push(`LOCATION:${escapeText(ev.location)}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF;
}
