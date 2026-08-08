'use client';
/**
 * /calendar — Spir同等の週カレンダー画面。
 * 左サイドバー：自分のリンク一覧
 * 右：週カレンダー（Google Calendarの実際の予定を表示）
 */
import { useEffect, useMemo, useState } from 'react';
import '../scheduler.css';

const TZ = 'Asia/Tokyo';
const HOUR_START = 8;
const HOUR_END = 22;
const SLOT_PX = 60; // 1時間=60px

type PageRow = {
  id: string;
  slug: string;
  isActive: boolean;
  settings: { title?: string; duration_minutes?: number } | null;
};

type BusyDto = { start: string; end: string; title?: string };

// ---- 日付ユーティリティ ----
function msToJstYmd(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}

function jstDateMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00+09:00`).getTime();
}

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

function startOfWeekJst(ms: number): number {
  const ymd = msToJstYmd(ms);
  const baseMs = jstDateMs(ymd);
  const dowJa = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(baseMs));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dowIdx = dowMap[dowJa] ?? 0;
  const offset = (dowIdx + 6) % 7;
  return baseMs - offset * 24 * 60 * 60 * 1000;
}

function dayStartHourMs(ymd: string): number {
  return new Date(`${ymd}T${String(HOUR_START).padStart(2, '0')}:00:00+09:00`).getTime();
}

function msToTopPx(ms: number, dayYmd: string): number {
  const base = dayStartHourMs(dayYmd);
  const min = (ms - base) / 60000;
  const totalMin = (HOUR_END - HOUR_START) * 60;
  const clamped = Math.max(0, Math.min(totalMin, min));
  return (clamped / 60) * SLOT_PX;
}

function durationMsToHeightPx(start: number, end: number, dayYmd: string): number {
  const dayBase = dayStartHourMs(dayYmd);
  const dayEnd = dayBase + (HOUR_END - HOUR_START) * 60 * 60 * 1000;
  const s = Math.max(start, dayBase);
  const e = Math.min(end, dayEnd);
  if (e <= s) return 0;
  const min = (e - s) / 60000;
  return Math.max(8, (min / 60) * SLOT_PX);
}

function fmtWeekRange(weekStartMs: number): string {
  const endMs = addDays(weekStartMs, 6);
  const startDate = new Date(weekStartMs);
  const endDate = new Date(endMs);
  const startStr = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric',
  }).format(startDate);
  const endStr = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ, month: 'long', day: 'numeric',
  }).format(endDate);
  return `${startStr} 〜 ${endStr}`;
}

// ---- コンポーネント ----
export default function CalendarPage() {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [busy, setBusy] = useState<BusyDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewWeekStart, setViewWeekStart] = useState<number>(() => startOfWeekJst(Date.now()));

  // リンク一覧取得（主催者はサーバ側でセッションから決まる）
  useEffect(() => {
    fetch('/api/pages', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { pages: PageRow[] }) => {
        const clean = (j.pages || []).filter((p) => {
          const t = (p.settings as { title?: unknown } | null | undefined)?.title;
          return typeof t !== 'string' || !t.includes('');
        });
        setPages(clean);
      })
      .catch(() => setPages([]));
  }, []);

  // busyデータ取得（週が変わるたびに再取得）
  useEffect(() => {
    setLoading(true);
    setBusy([]);
    const periodStart = new Date(viewWeekStart).toISOString();
    const periodEnd = new Date(addDays(viewWeekStart, 7)).toISOString();

    fetch('/api/availability/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        calendarIds: 'auto',
        periodStart,
        periodEnd,
        durationMinutes: 30,
        gridMinutes: 15,
        maxSlots: 100,
      }),
    })
      .then((r) => r.json())
      .then((data: { busy?: BusyDto[]; busyByCalendar?: Record<string, BusyDto[]> }) => {
        // busyByCalendar から全busy を集約（title付き）
        const allBusy: BusyDto[] = [];
        if (data.busyByCalendar) {
          for (const items of Object.values(data.busyByCalendar)) {
            allBusy.push(...items);
          }
        } else if (data.busy) {
          allBusy.push(...data.busy);
        }
        setBusy(allBusy);
      })
      .catch(() => setBusy([]))
      .finally(() => setLoading(false));
  }, [viewWeekStart]);

  // 表示週の各日
  const weekDays = useMemo(() => {
    const todayYmd = msToJstYmd(Date.now());
    const out = [];
    for (let i = 0; i < 7; i++) {
      const ms = addDays(viewWeekStart, i);
      const ymd = msToJstYmd(ms);
      const dowJa = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, weekday: 'short' }).format(new Date(ms));
      const day = Number(ymd.slice(8, 10));
      const month = Number(ymd.slice(5, 7));
      out.push({ ms, ymd, dowJa, day, month, isToday: ymd === todayYmd });
    }
    return out;
  }, [viewWeekStart]);

  // busy → 日別マップ
  const busyForDay = useMemo(() => {
    return (ymd: string): BusyDto[] => {
      const dayStart = jstDateMs(ymd);
      const dayEnd = addDays(dayStart, 1);
      return busy.filter((b) => {
        const s = Date.parse(b.start);
        const e = Date.parse(b.end);
        return s < dayEnd && e > dayStart;
      });
    };
  }, [busy]);

  const gridHeight = (HOUR_END - HOUR_START) * SLOT_PX;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--sc-bg)', fontFamily: '-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif' }}>

      {/* 左サイドバー */}
      <aside style={{
        width: 220,
        minWidth: 220,
        background: '#fff',
        borderRight: '1px solid var(--sc-line)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}>
        {/* ロゴ */}
        <a href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 12px', borderBottom: '1px solid var(--sc-line)' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--sc-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>📅</span>
          <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--sc-ink)' }}>スケ調くん</span>
        </a>

        {/* リンク一覧 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <div style={{ padding: '0 12px 8px', fontSize: 11, fontWeight: 700, color: 'var(--sc-sub)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            リンク一覧
          </div>

          {pages === null ? (
            <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--sc-sub)' }}>読み込み中…</div>
          ) : pages.length === 0 ? (
            <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--sc-sub)' }}>リンクがありません</div>
          ) : (
            pages.map((p) => {
              const title = p.settings?.title || '(無題)';
              const duration = p.settings?.duration_minutes;
              return (
                <a
                  key={p.id}
                  href={`/b/${p.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    padding: '8px 16px',
                    textDecoration: 'none',
                    borderRadius: 8,
                    margin: '2px 8px',
                    background: 'transparent',
                    transition: 'background .1s',
                    opacity: p.isActive ? 1 : 0.45,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--sc-brand-soft)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: p.isActive ? 'var(--sc-ink)' : 'var(--sc-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {title}
                  </div>
                  {duration && (
                    <div style={{ fontSize: 11, color: 'var(--sc-sub)', marginTop: 2 }}>
                      {duration}分
                      {!p.isActive && <span style={{ marginLeft: 6, color: '#dc2626', fontSize: 10 }}>非アクティブ</span>}
                    </div>
                  )}
                </a>
              );
            })
          )}
        </div>

        {/* フッターボタン */}
        <div style={{ borderTop: '1px solid var(--sc-line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <a href="/create" style={{ display: 'block', textAlign: 'center', padding: '8px 12px', background: 'var(--sc-brand)', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
            ＋ 新規リンク
          </a>
          <a href="/links" style={{ display: 'block', textAlign: 'center', padding: '7px 12px', background: '#fff', border: '1px solid var(--sc-line)', color: 'var(--sc-ink)', borderRadius: 8, fontSize: 12, textDecoration: 'none' }}>
            すべてのリンク →
          </a>
        </div>
      </aside>

      {/* 右メイン：週カレンダー */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* ツールバー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 56, background: '#fff', borderBottom: '1px solid var(--sc-line)', flexShrink: 0 }}>
          <button
            onClick={() => setViewWeekStart(startOfWeekJst(Date.now()))}
            style={{ border: '1px solid var(--sc-line)', background: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, color: 'var(--sc-ink)' }}
          >
            今週
          </button>
          <button
            onClick={() => setViewWeekStart((v) => addDays(v, -7))}
            style={{ width: 32, height: 32, border: '1px solid var(--sc-line)', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="前週"
          >‹</button>
          <button
            onClick={() => setViewWeekStart((v) => addDays(v, 7))}
            style={{ width: 32, height: 32, border: '1px solid var(--sc-line)', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="次週"
          >›</button>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--sc-ink)' }}>
            {fmtWeekRange(viewWeekStart)}
          </span>
          {loading && (
            <span style={{ fontSize: 12, color: 'var(--sc-sub)', marginLeft: 8 }}>読込中…</span>
          )}
        </div>

        {/* カレンダーグリッド */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', background: '#fff', minWidth: 600 }}>

            {/* ヘッダ行 */}
            <div style={{ borderBottom: '1px solid var(--sc-line)', borderRight: '1px solid var(--sc-line)' }} />
            {weekDays.map((d) => (
              <div
                key={d.ymd}
                style={{
                  textAlign: 'center',
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--sc-line)',
                  borderRight: '1px solid var(--sc-line)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--sc-sub)', marginBottom: 2 }}>{d.dowJa}</div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: d.isToday ? 'var(--sc-brand)' : 'transparent',
                  color: d.isToday ? '#fff' : 'var(--sc-ink)',
                  fontWeight: 700,
                  fontSize: 15,
                }}>
                  {d.day}
                </div>
              </div>
            ))}

            {/* ボディ：時刻ラベル + 日カラム */}
            {/* 時刻列 */}
            <div style={{ borderRight: '1px solid var(--sc-line)', position: 'relative', height: gridHeight }}>
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START).map((h) => (
                <div
                  key={h}
                  style={{
                    position: 'absolute',
                    top: (h - HOUR_START) * SLOT_PX - 7,
                    right: 6,
                    fontSize: 11,
                    color: 'var(--sc-sub)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* 各日カラム */}
            {weekDays.map((d) => {
              const dayBusy = busyForDay(d.ymd);
              return (
                <div
                  key={d.ymd}
                  style={{
                    position: 'relative',
                    height: gridHeight,
                    borderRight: '1px solid var(--sc-line)',
                    background: d.isToday ? '#fafcff' : '#fff',
                  }}
                >
                  {/* 時間ガイド線 */}
                  {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i).map((i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        top: i * SLOT_PX,
                        left: 0,
                        right: 0,
                        borderTop: '1px solid #f1f2f4',
                        pointerEvents: 'none',
                      }}
                    />
                  ))}

                  {/* 30分区切り線 */}
                  {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i).map((i) => (
                    <div
                      key={`half-${i}`}
                      style={{
                        position: 'absolute',
                        top: i * SLOT_PX + SLOT_PX / 2,
                        left: 0,
                        right: 0,
                        borderTop: '1px dashed #f1f2f4',
                        pointerEvents: 'none',
                      }}
                    />
                  ))}

                  {/* 予定ブロック */}
                  {dayBusy.map((b, bi) => {
                    const startMs = Date.parse(b.start);
                    const endMs = Date.parse(b.end);
                    const top = msToTopPx(startMs, d.ymd);
                    const height = durationMsToHeightPx(startMs, endMs, d.ymd);
                    if (height <= 0) return null;
                    const startTime = new Date(startMs).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                    const endTime = new Date(endMs).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                    return (
                      <div
                        key={`b${bi}`}
                        style={{
                          position: 'absolute',
                          top,
                          height,
                          left: 2,
                          right: 2,
                          borderRadius: 5,
                          background: 'rgba(37,99,235,0.12)',
                          borderLeft: '3px solid #2563eb',
                          overflow: 'hidden',
                          padding: '2px 4px',
                          fontSize: 11,
                          color: '#1e40af',
                        }}
                        title={b.title ? `${b.title} ${startTime}-${endTime}` : `${startTime}-${endTime}`}
                      >
                        {height >= 20 && (
                          <>
                            {b.title && (
                              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {b.title}
                              </div>
                            )}
                            {height >= 32 && (
                              <div style={{ opacity: 0.8 }}>{startTime}-{endTime}</div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
