'use client';
/**
 * /propose — Spirの「候補を自動抽出」相当の3カラムUI。
 * 左：設定（タイトル・調整タイプT2/T3・打合せ時間・期間・営業時間・バッファ）
 * 中：予定を考慮するカレンダー（複数選択）
 * 右：Spir風 週カレンダーグリッド（既存予定=色付きブロック / 候補=青点線オーバーレイ）
 *     候補ブロッククリックで個別トグル → 「この候補を反映」で予約ページ作成
 */
import { useEffect, useMemo, useState } from 'react';
import '../scheduler.css';

type Calendar = {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
};

type SlotDto = { start: string; end: string };
type BusyDto = { start: string; end: string; title?: string };
type BusyByCalendar = Record<string, BusyDto[]>;

const TZ = 'Asia/Tokyo';
const HOUR_START = 8; // 表示開始
const HOUR_END = 23; // 表示終了
const SLOT_PX = 60; // 1時間=60px

function fmtSlotJa(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: '2-digit', day: '2-digit' }).formatToParts(s);
  const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const m = Number(obj.month);
  const d = Number(obj.day);
  const dowJa = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, weekday: 'short' }).format(s);
  const sh = s.toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const eh = e.toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${m}/${d}（${dowJa}） ${sh}-${eh}`;
}

function fmtTimeJa(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function randSlug(): string {
  let s = '';
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// JST の YYYY-MM-DD を Date(00:00 JST) として ms に
function jstDateMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00+09:00`).getTime();
}
// ms から JST の YYYY-MM-DD を返す
function msToJstYmd(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
// 月曜開始の週初め（JST）を返す
function startOfWeekJst(ms: number): number {
  const ymd = msToJstYmd(ms);
  const baseMs = jstDateMs(ymd);
  // baseMs が何曜日か（0=日…6=土）。月=1 にするため (dow+6)%7 を引く
  const dow = new Date(baseMs).getUTCDay() === 0 ? 0 : new Date(baseMs).getUTCDay();
  // JST 00:00 のときの UTC 曜日は前日になる可能性があるため、JST の曜日で取り直す
  const dowJa = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(baseMs));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dowJaIdx = dowMap[dowJa] ?? dow;
  const offset = (dowJaIdx + 6) % 7;
  return baseMs - offset * 24 * 60 * 60 * 1000;
}

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

// その日の HOUR_START 時点（JST）を ms で
function dayStartHourMs(ymd: string): number {
  return new Date(`${ymd}T${String(HOUR_START).padStart(2, '0')}:00:00+09:00`).getTime();
}

// ms → グリッド上の top px（その日 HOUR_START からの分 / 60 * SLOT_PX）。範囲外は clamp。
function msToTopPx(ms: number, dayYmd: string): number {
  const base = dayStartHourMs(dayYmd);
  const min = (ms - base) / 60000;
  const totalMin = (HOUR_END - HOUR_START) * 60;
  const clamped = Math.max(0, Math.min(totalMin, min));
  return (clamped / 60) * SLOT_PX;
}

// 区間長(ms) → 高さ px
function durationMsToHeightPx(start: number, end: number, dayYmd: string): number {
  const dayBase = dayStartHourMs(dayYmd);
  const dayEnd = dayBase + (HOUR_END - HOUR_START) * 60 * 60 * 1000;
  const s = Math.max(start, dayBase);
  const e = Math.min(end, dayEnd);
  if (e <= s) return 0;
  const min = (e - s) / 60000;
  return Math.max(8, (min / 60) * SLOT_PX);
}

// hex / "#rrggbb" or "#rgb" → rgba(r,g,b,a) 文字列に
function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(156,163,175,${alpha})`;
  const m = hex.trim().replace('#', '');
  let r = 156, g = 163, b = 175;
  if (m.length === 3) {
    r = parseInt(m[0]! + m[0]!, 16);
    g = parseInt(m[1]! + m[1]!, 16);
    b = parseInt(m[2]! + m[2]!, 16);
  } else if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function ProposePage() {
  // 設定
  const [title, setTitle] = useState('');
  const [adjType, setAdjType] = useState<'T2' | 'T3'>('T2');
  const [duration, setDuration] = useState(30);
  const [periodStart, setPeriodStart] = useState(plusDaysIso(1));
  const [periodEnd, setPeriodEnd] = useState(plusDaysIso(14));
  const [whStart, setWhStart] = useState('09:00');
  const [whEnd, setWhEnd] = useState('18:00');
  const [bufBefore, setBufBefore] = useState(0);
  const [bufAfter, setBufAfter] = useState(10);
  const [minNotice, setMinNotice] = useState(60);
  const [maxSlots, setMaxSlots] = useState(10);

  // カレンダー
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCals, setSelectedCals] = useState<Set<string>>(new Set());
  const [loadingCals, setLoadingCals] = useState(true);

  // 抽出結果
  const [slots, setSlots] = useState<SlotDto[]>([]);
  const [busyByCalendar, setBusyByCalendar] = useState<BusyByCalendar>({});
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  // 左/中ペインの折りたたみ（カレンダーを最大化したいとき用・localStorage で記憶）
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [midCollapsed, setMidCollapsed] = useState(false);
  useEffect(() => {
    try {
      setLeftCollapsed(localStorage.getItem('schedule-relay:propose-left-collapsed') === '1');
      setMidCollapsed(localStorage.getItem('schedule-relay:propose-mid-collapsed') === '1');
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('schedule-relay:propose-left-collapsed', leftCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [leftCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('schedule-relay:propose-mid-collapsed', midCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [midCollapsed]);
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string | null>(null);

  // 週ナビ：表示開始週（月曜・JST ms）
  // 初期表示は「期間開始日が含まれる週」（今日の週がまだ期間に入っていない場合の白紙画面を避ける）
  const [viewWeekStart, setViewWeekStart] = useState<number>(() => startOfWeekJst(jstDateMs(plusDaysIso(1))));
  // periodStart が変わったら、表示週もその週に追従（期間外を見続ける白紙状態を防ぐ）
  useEffect(() => {
    setViewWeekStart(startOfWeekJst(jstDateMs(periodStart)));
  }, [periodStart]);

  // 反映結果
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneVoteUrl, setDoneVoteUrl] = useState<string | null>(null);
  const [copyText, setCopyText] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingCals(true);
      try {
        const res = await fetch('/api/google/calendars');
        const data = await res.json();
        const cals: Calendar[] = data.calendars ?? [];
        setCalendars(cals);
        // 前回の選択を localStorage から復元（無ければ primary を既定で選択）
        const init = new Set<string>();
        let restored = false;
        try {
          const raw = localStorage.getItem('schedule-relay:propose-calendars');
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            const valid = new Set(cals.map((c) => c.id));
            for (const id of ids) if (valid.has(id)) init.add(id);
            if (init.size > 0) restored = true;
          }
        } catch {
          /* 壊れた値は無視 */
        }
        if (!restored) {
          for (const c of cals) if (c.primary) init.add(c.id);
          if (init.size === 0 && cals.length > 0) init.add(cals[0]!.id);
        }
        setSelectedCals(init);
      } catch {
        setCalendars([]);
      } finally {
        setLoadingCals(false);
      }
    })();
  }, []);

  // selectedCals が変わるたびに localStorage に保存（次回起動時に自動復元）
  useEffect(() => {
    if (loadingCals) return; // 初期ロード中は保存しない
    try {
      localStorage.setItem('schedule-relay:propose-calendars', JSON.stringify([...selectedCals]));
    } catch {
      /* QuotaExceeded 等は無視 */
    }
  }, [selectedCals, loadingCals]);

  const canExtract = useMemo(() => {
    return periodStart < periodEnd && whStart < whEnd && !extracting;
  }, [title, periodStart, periodEnd, whStart, whEnd, extracting]);

  // カレンダーID → 色 マップ
  const calColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.backgroundColor || '#9ca3af');
    return m;
  }, [calendars]);

  async function extract() {
    setExtracting(true);
    setExtractErr(null);
    setSlots([]);
    setBusyByCalendar({});
    setSelectedSlots(new Set());
    try {
      const body = {
        calendarIds: Array.from(selectedCals),
        periodStart: new Date(`${periodStart}T00:00:00+09:00`).toISOString(),
        periodEnd: new Date(`${periodEnd}T23:59:59+09:00`).toISOString(),
        durationMinutes: duration,
        workingHours: {
          tz: 'Asia/Tokyo',
          mon_fri: [whStart, whEnd],
          sat: [],
          sun: [],
        },
        bufferBeforeMin: bufBefore,
        bufferAfterMin: bufAfter,
        minNoticeMin: minNotice,
        maxSlots,
      };
      const res = await fetch('/api/availability/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || '抽出に失敗しました');
      const got: SlotDto[] = data.slots ?? [];
      setSlots(got);
      setBusyByCalendar((data.busyByCalendar ?? {}) as BusyByCalendar);
      // 既定で全件選択
      setSelectedSlots(new Set(got.map((_, i) => i)));
      // ビューを期間開始週に合わせる
      setViewWeekStart(startOfWeekJst(jstDateMs(periodStart)));
    } catch (e) {
      setExtractErr(e instanceof Error ? e.message : '抽出に失敗しました');
    } finally {
      setExtracting(false);
    }
  }

  async function applySelected() {
    setApplying(true);
    setApplyErr(null);
    try {
      const slug = randSlug();
      const settings = {
        title: (title.trim() || '日程候補'),
        description: '',
        duration_minutes: duration,
        grid_minutes: 15,
        min_notice_minutes: minNotice,
        horizon_days: 30,
        buffer_minutes: { before: bufBefore, after: bufAfter },
        working_hours: {
          tz: 'Asia/Tokyo',
          mon_fri: [whStart, whEnd],
          sat: [],
          sun: [],
        },
      };
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizerId: 'takagi', type: adjType, slug, settings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || '作成に失敗しました');
      const origin = window.location.origin;
      const url = `${origin}/b/${slug}`;
      setDoneUrl(url);
      if (adjType === 'T3') {
        setDoneVoteUrl(`${origin}/v/${data.page?.id ?? slug}`);
      }
      // メール本文用テキスト
      const lines = Array.from(selectedSlots)
        .sort((a, b) => a - b)
        .map((i) => slots[i])
        .filter((s): s is SlotDto => !!s)
        .map((s) => `・${fmtSlotJa(s.start, s.end)}`);
      setCopyText(
        [
          `${(title.trim() || '日程候補')} の候補です。`,
          '',
          ...lines,
          '',
          `ご都合の良い枠を選んでご予約ください： ${url}`,
        ].join('\n'),
      );
      // localStorageに保存
      try {
        const KEY = 'schedule-relay:my-pages';
        const prev = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown[];
        const filtered = Array.isArray(prev)
          ? prev.filter((p) => p && typeof p === 'object' && (p as { slug?: unknown }).slug !== slug)
          : [];
        localStorage.setItem(
          KEY,
          JSON.stringify(
            [
              {
                slug,
                title: (title.trim() || '日程候補'),
                durationMin: duration,
                createdAt: new Date().toISOString(),
              },
              ...filtered,
            ].slice(0, 50),
          ),
        );
      } catch { /* noop */ }
    } catch (e) {
      setApplyErr(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setApplying(false);
    }
  }

  function toggleCal(id: string) {
    setSelectedCals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function removeCal(id: string) {
    setSelectedCals((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  function toggleSlot(i: number) {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // 表示週の各日 YMD（月-日）
  const weekDays = useMemo(() => {
    const out: { ms: number; ymd: string; dowJa: string; day: number; isToday: boolean; outOfPeriod: boolean }[] = [];
    const todayYmd = msToJstYmd(Date.now());
    const periodStartMs = jstDateMs(periodStart);
    const periodEndMs = jstDateMs(periodEnd);
    for (let i = 0; i < 7; i++) {
      const ms = addDays(viewWeekStart, i);
      const ymd = msToJstYmd(ms);
      const dowJa = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, weekday: 'short' }).format(new Date(ms));
      const day = Number(ymd.slice(8, 10));
      out.push({
        ms,
        ymd,
        dowJa,
        day,
        isToday: ymd === todayYmd,
        outOfPeriod: ms < periodStartMs || ms > periodEndMs,
      });
    }
    return out;
  }, [viewWeekStart, periodStart, periodEnd]);

  // 表示月（先頭日の月）
  const viewMonthLabel = useMemo(() => {
    const head = weekDays[0]?.ms ?? Date.now();
    return new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, year: 'numeric', month: 'long' }).format(new Date(head));
  }, [weekDays]);

  // 表示週・各日に該当する busy ブロック
  const busyForDay = useMemo(() => {
    return (ymd: string): { calId: string; start: number; end: number; title?: string }[] => {
      const dayStart = jstDateMs(ymd);
      const dayEnd = addDays(dayStart, 1);
      const out: { calId: string; start: number; end: number; title?: string }[] = [];
      for (const calId of Object.keys(busyByCalendar)) {
        for (const b of busyByCalendar[calId] ?? []) {
          const s = Date.parse(b.start);
          const e = Date.parse(b.end);
          if (e <= dayStart || s >= dayEnd) continue;
          const item: { calId: string; start: number; end: number; title?: string } = { calId, start: s, end: e };
          if (b.title) item.title = b.title;
          out.push(item);
        }
      }
      return out;
    };
  }, [busyByCalendar]);

  // 表示週・各日に該当する候補
  const candForDay = useMemo(() => {
    return (ymd: string): { idx: number; start: number; end: number }[] => {
      const dayStart = jstDateMs(ymd);
      const dayEnd = addDays(dayStart, 1);
      const out: { idx: number; start: number; end: number }[] = [];
      slots.forEach((s, i) => {
        const sMs = Date.parse(s.start);
        const eMs = Date.parse(s.end);
        if (eMs <= dayStart || sMs >= dayEnd) return;
        out.push({ idx: i, start: sMs, end: eMs });
      });
      return out;
    };
  }, [slots]);

  return (
    <div className="sc-wrap">
      <div className="sc-topbar">
        <div className="sc-logo"><span className="mk">📅</span>スケジュール調整くん</div>
        <div className="sc-spacer" />
        <span className="sc-pill">候補を自動抽出</span>
      </div>

      {doneUrl ? (
        <div style={{ maxWidth: 720, margin: '40px auto', padding: 20 }}>
          <div className="sc-done">
            <h3 style={{ margin: '0 0 8px' }}>✅ 候補を反映しました</h3>
            <p style={{ margin: 0, fontSize: 13 }}>このURLを相手に送るだけ。相手は空いている枠を選ぶだけで日程が決まります。</p>
            <div className="sc-link">
              <input readOnly value={doneUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="sc-btn primary" style={{ flex: 'none' }} onClick={() => { navigator.clipboard.writeText(doneUrl); }}>コピー</button>
            </div>
            {doneVoteUrl && (
              <div className="sc-link" style={{ marginTop: 8 }}>
                <input readOnly value={doneVoteUrl} onFocus={(e) => e.currentTarget.select()} />
                <button className="sc-btn ghost" style={{ flex: 'none' }} onClick={() => { navigator.clipboard.writeText(doneVoteUrl); }}>投票URLをコピー</button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>メール本文用テキスト</h4>
            <textarea
              readOnly
              value={copyText}
              rows={Math.min(20, Math.max(5, copyText.split('\n').length + 1))}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: 10, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', boxSizing: 'border-box', resize: 'vertical' }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div style={{ marginTop: 8 }}>
              <button className="sc-btn primary" onClick={() => navigator.clipboard.writeText(copyText)}>テキストをコピー</button>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <a className="sc-btn primary" style={{ textDecoration: 'none', display: 'inline-block' }} href={doneUrl}>予約ページを開く</a>
            <a className="sc-btn ghost" style={{ textDecoration: 'none', display: 'inline-block' }} href="/propose" onClick={() => location.reload()}>もう1回抽出する</a>
          </div>
        </div>
      ) : (
        <div className={`sc-propose${leftCollapsed ? ' left-collapsed' : ''}${midCollapsed ? ' mid-collapsed' : ''}`}>
          {/* 左ペイン：設定 */}
          <aside className={`pp-left${leftCollapsed ? ' collapsed' : ''}`}>
            {leftCollapsed ? (
              <button className="pp-collapse-bar" title="設定を開く" onClick={() => setLeftCollapsed(false)}>
                <span className="pp-collapse-icon">›</span>
                <span className="pp-collapse-label">候補を自動抽出</span>
              </button>
            ) : (
              <>
            <div className="pp-pane-header">
              <h2 style={{ margin: 0 }}>候補を自動抽出</h2>
              <button className="pp-collapse-btn" title="閉じる" onClick={() => setLeftCollapsed(true)}>‹</button>
            </div>
            <p className="lead">期間と打合せ時間を指定すると、あなたのカレンダーの空きから候補を自動で抽出します。</p>

            <div className="sc-field">
              <label>タイトル<span className="req">*</span></label>
              <input className="sc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 髙木産業 ご面談" />
            </div>

            <div className="sc-field">
              <label>調整タイプ</label>
              <div className="sc-seg">
                <button className={adjType === 'T2' ? 'on' : ''} onClick={() => setAdjType('T2')}>確定型 (T2)</button>
                <button className={adjType === 'T3' ? 'on' : ''} onClick={() => setAdjType('T3')}>投票型 (T3)</button>
              </div>
            </div>

            <div className="sc-field">
              <label>打合せ時間</label>
              <select className="sc-select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d}分</option>)}
              </select>
            </div>

            <div className="sc-field">
              <label>期間</label>
              <div className="sc-row2">
                <input className="sc-input" type="date" value={periodStart} min={todayIso()} onChange={(e) => setPeriodStart(e.target.value)} />
                <input className="sc-input" type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            <div className="sc-field">
              <label>営業時間（平日）</label>
              <div className="sc-row2">
                <input className="sc-input" type="time" value={whStart} onChange={(e) => setWhStart(e.target.value)} />
                <input className="sc-input" type="time" value={whEnd} onChange={(e) => setWhEnd(e.target.value)} />
              </div>
            </div>

            <div className="sc-field">
              <label>前後の確保時間（バッファ）</label>
              <div className="sc-row2">
                <select className="sc-select" value={bufBefore} onChange={(e) => setBufBefore(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>前 {m}分</option>)}
                </select>
                <select className="sc-select" value={bufAfter} onChange={(e) => setBufAfter(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>後 {m}分</option>)}
                </select>
              </div>
            </div>

            <div className="sc-field">
              <label>直前ブロック</label>
              <select className="sc-select" value={minNotice} onChange={(e) => setMinNotice(Number(e.target.value))}>
                {[0, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m === 1440 ? '24時間前まで' : `${m}分前まで`}</option>)}
              </select>
            </div>

            <div className="sc-field">
              <label>抽出件数</label>
              <select className="sc-select" value={maxSlots} onChange={(e) => setMaxSlots(Number(e.target.value))}>
                {[5, 10, 20, 30, 50].map((m) => <option key={m} value={m}>{m}件</option>)}
              </select>
            </div>

            <button className="sc-btn primary" disabled={!canExtract} onClick={extract} style={{ width: '100%' }}>
              {extracting ? '抽出中…' : '候補を自動抽出'}
            </button>
            {extractErr && <div className="sc-err" style={{ marginTop: 10 }}>{extractErr}</div>}
              </>
            )}
          </aside>

          {/* 中ペイン：カレンダー選択 */}
          <section className={`pp-mid${midCollapsed ? ' collapsed' : ''}`}>
            {midCollapsed ? (
              <button className="pp-collapse-bar" title="カレンダーを開く" onClick={() => setMidCollapsed(false)}>
                <span className="pp-collapse-icon">›</span>
                <span className="pp-collapse-label">予定を考慮するカレンダー</span>
              </button>
            ) : (
              <>
              <div className="pp-pane-header">
                <h2 style={{ margin: 0 }}>予定を考慮するカレンダー</h2>
                <button className="pp-collapse-btn" title="閉じる" onClick={() => setMidCollapsed(true)}>‹</button>
              </div>
            <p className="lead">チェックを入れたカレンダーの予定を「埋まっている時間」として除外します。</p>
            {loadingCals ? (
              <div style={{ fontSize: 13, color: '#6b7280' }}>読み込み中…</div>
            ) : calendars.length === 0 ? (
              <div style={{ fontSize: 13, color: '#6b7280', padding: 12, background: '#fafafa', borderRadius: 8 }}>
                Googleカレンダー連携が未設定のため、営業時間ベースで候補を出します。
              </div>
            ) : (
              <>
                <div className="pp-callist">
                  {calendars.map((c) => {
                    const on = selectedCals.has(c.id);
                    return (
                      <label key={c.id} className={`pp-calitem ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleCal(c.id)} />
                        <span className="dot" style={{ background: c.backgroundColor || '#9ca3af' }} />
                        <span className="name">{c.summary}{c.primary ? ' ★' : ''}</span>
                        {on && (
                          <button
                            type="button"
                            className="pp-x"
                            onClick={(e) => { e.preventDefault(); removeCal(c.id); }}
                            title="除外"
                          >×</button>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                  選択中: {selectedCals.size} / {calendars.length} カレンダー
                </div>
              </>
            )}
              </>
            )}
          </section>

          {/* 右ペイン：Spir風 週カレンダーグリッド */}
          <section className="pp-right">
            <div className="pp-cal-wrap">
              <div className="pp-cal-nav">
                <button className="pp-cal-today" onClick={() => setViewWeekStart(startOfWeekJst(Date.now()))}>今日</button>
                <button className="pp-cal-arrow" onClick={() => setViewWeekStart((v) => addDays(v, -7))} aria-label="前の週">&lt;</button>
                <button className="pp-cal-arrow" onClick={() => setViewWeekStart((v) => addDays(v, 7))} aria-label="次の週">&gt;</button>
                <span className="pp-cal-month">{viewMonthLabel}</span>
                <span className="pp-cal-spacer" />
                {slots.length > 0 && (
                  <span className="pp-cal-count">候補 {selectedSlots.size}/{slots.length} 件</span>
                )}
              </div>

              <div className="pp-cal-grid" role="grid" aria-label="週カレンダー">
                {/* ヘッダ行 */}
                <div className="pp-cal-head">
                  <div className="pp-cal-head-cell pp-cal-head-time" />
                  {weekDays.map((d) => (
                    <div key={d.ymd} className={`pp-cal-head-cell ${d.isToday ? 'today' : ''}`}>
                      <span className="dow">{d.dowJa}</span>
                      <span className="day">{d.day}</span>
                    </div>
                  ))}
                </div>

                {/* ボディ：時刻ラベル＋日カラム */}
                <div className="pp-cal-body">
                  {/* 1列目：時刻 */}
                  <div>
                    {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START).map((h) => (
                      <div key={h} className="pp-cal-time">{String(h).padStart(2, '0')}:00</div>
                    ))}
                  </div>
                  {/* 2..8列目：各日 */}
                  {weekDays.map((d) => {
                    const busy = busyForDay(d.ymd);
                    const cand = candForDay(d.ymd);
                    return (
                      <div key={d.ymd} className={`pp-cal-day ${d.outOfPeriod ? 'out-of-period' : ''}`}>
                        {/* 時間ガイド線 */}
                        {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START).map((h) => (
                          <div key={h} className="pp-cal-day-hour" />
                        ))}
                        {/* 既存予定ブロック */}
                        {busy.map((b, bi) => {
                          const top = msToTopPx(b.start, d.ymd);
                          const height = durationMsToHeightPx(b.start, b.end, d.ymd);
                          if (height <= 0) return null;
                          const color = calColorMap.get(b.calId) || '#9ca3af';
                          return (
                            <div
                              key={`b${bi}`}
                              className="pp-cal-busy"
                              style={{ top, height, background: hexToRgba(color, 0.85), borderColor: color }}
                              title={b.title || '予定あり'}
                            >
                              {b.title && <div className="pp-cal-busy-title">{b.title}</div>}
                              <div className="pp-cal-busy-time">
                                {new Date(b.start).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })}
                                {'-'}
                                {new Date(b.end).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })}
                              </div>
                            </div>
                          );
                        })}
                        {/* 候補ブロック：隣接する候補を1ブロックにマージして描画
                            （例：14:30-15:00 と 15:00-15:30 が連続 → 14:30-15:30 の1ブロック）。
                            クリックでグループ内の全slotを一括選択/解除。 */}
                        {(() => {
                          const sortedCand = [...cand].sort((a, b) => a.start - b.start);
                          const groups: { start: number; end: number; idxs: number[] }[] = [];
                          for (const c of sortedCand) {
                            const last = groups[groups.length - 1];
                            if (last && last.end === c.start) {
                              last.end = c.end;
                              last.idxs.push(c.idx);
                            } else {
                              groups.push({ start: c.start, end: c.end, idxs: [c.idx] });
                            }
                          }
                          return groups.map((g, gi) => {
                            const top = msToTopPx(g.start, d.ymd);
                            const height = durationMsToHeightPx(g.start, g.end, d.ymd);
                            if (height <= 0) return null;
                            const onCount = g.idxs.filter((i) => selectedSlots.has(i)).length;
                            const allOn = onCount === g.idxs.length;
                            const handleClick = () => {
                              setSelectedSlots((prev) => {
                                const next = new Set(prev);
                                if (allOn) {
                                  for (const i of g.idxs) next.delete(i);
                                } else {
                                  for (const i of g.idxs) next.add(i);
                                }
                                return next;
                              });
                            };
                            const startStr = new Date(g.start).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                            const endStr = new Date(g.end).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                            return (
                              <button
                                key={`cg${gi}`}
                                type="button"
                                className={`pp-cal-cand ${allOn ? 'on' : ''}`}
                                style={{ top, height }}
                                onClick={handleClick}
                                title={`${startStr}-${endStr}（${g.idxs.length}枠）`}
                              >
                                <div className="pp-cal-cand-label">候補{g.idxs.length > 1 ? `（${g.idxs.length}枠）` : ''}</div>
                                <div className="pp-cal-cand-time">{startStr}-{endStr}</div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pp-cal-legend">
                <span className="lg"><span className="sq busy" />既存予定</span>
                <span className="lg"><span className="sq cand" />候補</span>
                <span className="lg"><span className="sq out" />期間外</span>
              </div>

              {slots.length === 0 ? (
                <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280', padding: 12, background: '#fafafa', borderRadius: 8 }}>
                  「候補を自動抽出」を押すと、ここに候補がカレンダー上に表示されます。
                </div>
              ) : (
                <div className="pp-cal-footer">
                  <div className="pp-cal-summary">反映する候補: {selectedSlots.size} / {slots.length} 件</div>
                  <button
                    className="sc-btn primary"
                    disabled={selectedSlots.size === 0 || applying}
                    onClick={applySelected}
                  >
                    {applying ? '反映中…' : 'この候補を反映'}
                  </button>
                </div>
              )}
              {applyErr && <div className="sc-err" style={{ marginTop: 10 }}>{applyErr}</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
