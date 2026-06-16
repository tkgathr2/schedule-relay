/**
 * src/service/ical.ts のユニットテスト。RFC 5545 最小実装の振る舞いを検証する。
 *  - VCALENDAR/VERSION/PRODID/CALSCALE 必須
 *  - VEVENT 0個でも有効な VCALENDAR
 *  - UID / DTSTAMP / DTSTART / DTEND / SUMMARY 必須
 *  - DTSTART/DTEND は UTC YYYYMMDDTHHMMSSZ
 *  - CRLF 改行
 *  - 制御文字エスケープ ( \ ; , 改行 )
 *  - DESCRIPTION/LOCATION は任意
 *  - SUMMARY 特殊文字
 *  - X-WR-CALNAME（calName 指定時）
 */
import { describe, it, expect } from 'vitest';
import { buildIcs, type IcsEvent } from '../ical.js';

const D = (s: string): Date => new Date(s);

describe('buildIcs', () => {
  it('空配列でも有効な VCALENDAR を返す（VEVENT 0個）', () => {
    const ics = buildIcs([]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('VERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('BEGIN:VEVENT')).toBe(false);
  });

  it('1イベントを VEVENT として出力する', () => {
    const events: IcsEvent[] = [
      {
        uid: 'evt-1@test',
        start: D('2026-01-15T01:00:00Z'),
        end: D('2026-01-15T02:00:00Z'),
        summary: '面談',
      },
    ];
    const ics = buildIcs(events);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics.match(/END:VEVENT/g)?.length).toBe(1);
    expect(ics).toContain('UID:evt-1@test');
    expect(ics).toContain('SUMMARY:面談');
  });

  it('複数イベントをすべて VEVENT 化する', () => {
    const events: IcsEvent[] = [
      { uid: 'a', start: D('2026-01-01T00:00:00Z'), end: D('2026-01-01T01:00:00Z'), summary: 'A' },
      { uid: 'b', start: D('2026-01-02T00:00:00Z'), end: D('2026-01-02T01:00:00Z'), summary: 'B' },
      { uid: 'c', start: D('2026-01-03T00:00:00Z'), end: D('2026-01-03T01:00:00Z'), summary: 'C' },
    ];
    const ics = buildIcs(events);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(3);
    expect(ics).toContain('UID:a');
    expect(ics).toContain('UID:b');
    expect(ics).toContain('UID:c');
  });

  it('UID は各イベントに 1 行出力される', () => {
    const ics = buildIcs([
      { uid: 'unique-uid-123@h', start: D('2026-01-01T00:00:00Z'), end: D('2026-01-01T01:00:00Z'), summary: 'x' },
    ]);
    const uidLines = ics.split('\r\n').filter((l) => l.startsWith('UID:'));
    expect(uidLines).toEqual(['UID:unique-uid-123@h']);
  });

  it('テキスト値の制御文字をエスケープする ( ; , \\ 改行 )', () => {
    const ics = buildIcs([
      {
        uid: 'esc',
        start: D('2026-01-01T00:00:00Z'),
        end: D('2026-01-01T01:00:00Z'),
        summary: 'a;b,c\\d',
        description: 'line1\nline2\r\nline3',
        location: 'comma, semi; back\\slash',
      },
    ]);
    expect(ics).toContain('SUMMARY:a\\;b\\,c\\\\d');
    expect(ics).toContain('DESCRIPTION:line1\\nline2\\nline3');
    expect(ics).toContain('LOCATION:comma\\, semi\\; back\\\\slash');
  });

  it('全行は CRLF で区切られている（裸の LF が無い）', () => {
    const ics = buildIcs([
      { uid: 'x', start: D('2026-01-01T00:00:00Z'), end: D('2026-01-01T01:00:00Z'), summary: 's' },
    ]);
    // CRLF 以外の単独 LF は存在しないこと
    const withoutCrlf = ics.replace(/\r\n/g, '');
    expect(withoutCrlf.includes('\n')).toBe(false);
    expect(withoutCrlf.includes('\r')).toBe(false);
  });

  it('DTSTART/DTEND は UTC YYYYMMDDTHHMMSSZ 形式', () => {
    const ics = buildIcs([
      {
        uid: 'utc',
        start: new Date(Date.UTC(2026, 0, 15, 9, 30, 45)),
        end: new Date(Date.UTC(2026, 0, 15, 10, 0, 0)),
        summary: 's',
      },
    ]);
    expect(ics).toContain('DTSTART:20260115T093045Z');
    expect(ics).toContain('DTEND:20260115T100000Z');
  });

  it('PRODID と CALSCALE:GREGORIAN を必ず含む', () => {
    const ics = buildIcs([]);
    expect(ics).toMatch(/PRODID:[^\r\n]+/);
    expect(ics).toContain('CALSCALE:GREGORIAN');
  });

  it('SUMMARY の特殊文字（日本語・絵文字・記号）が壊れない', () => {
    const ics = buildIcs([
      {
        uid: 'jp',
        start: D('2026-01-01T00:00:00Z'),
        end: D('2026-01-01T01:00:00Z'),
        summary: '【空き枠】打合せ📅 50%OFF',
      },
    ]);
    // ; と , はエスケープされるがそれ以外（絵文字や%）はそのまま出る
    expect(ics).toContain('SUMMARY:【空き枠】打合せ📅 50%OFF');
  });

  it('LOCATION/DESCRIPTION は任意（未指定なら行が出ない）', () => {
    const ics = buildIcs([
      { uid: 'noloc', start: D('2026-01-01T00:00:00Z'), end: D('2026-01-01T01:00:00Z'), summary: 's' },
    ]);
    expect(ics.includes('LOCATION:')).toBe(false);
    expect(ics.includes('DESCRIPTION:')).toBe(false);
  });

  it('calName を指定すると X-WR-CALNAME に書き出す', () => {
    const ics = buildIcs([], { calName: 'マイカレンダー' });
    expect(ics).toContain('X-WR-CALNAME:マイカレンダー');
  });

  it('DTSTAMP は UTC YYYYMMDDTHHMMSSZ 形式で各 VEVENT に存在する', () => {
    const ics = buildIcs([
      { uid: 'ts1', start: D('2026-01-01T00:00:00Z'), end: D('2026-01-01T01:00:00Z'), summary: 'a' },
      { uid: 'ts2', start: D('2026-01-02T00:00:00Z'), end: D('2026-01-02T01:00:00Z'), summary: 'b' },
    ]);
    const stamps = ics.split('\r\n').filter((l) => l.startsWith('DTSTAMP:'));
    expect(stamps.length).toBe(2);
    for (const s of stamps) {
      expect(s).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
    }
  });
});
