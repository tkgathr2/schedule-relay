'use client';
/**
 * /propose — Spirの「候補を自動抽出」相当の3カラムUI。
 * 左：設定（タイトル・調整タイプT2/T3・打合せ時間・期間・営業時間・バッファ）
 * 中：予定を考慮するカレンダー（複数選択）
 * 右：Spir風 週カレンダーグリッド（既存予定=色付きブロック / 候補=青点線オーバーレイ）
 *     候補ブロッククリックで個別トグル → 「この候補を反映」で予約ページ作成
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../scheduler.css';
import { moveRange, resizeEnd, nextBusyStart, hasConflict, groupSlots } from '../../src/domain/drag';

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

// 曜日ごとの営業時間（社長要望：土日も候補に含める／水曜だけ休みにする、等の個別設定用）
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DayHours = { enabled: boolean; start: string; end: string };
const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<DayKey, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
// JS の Date#getDay()（0=日〜6=土）→ DayKey の対応表
const WEEKDAY_TO_KEY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function defaultWeeklyHours(): Record<DayKey, DayHours> {
  return {
    mon: { enabled: true, start: '09:00', end: '18:00' },
    tue: { enabled: true, start: '09:00', end: '18:00' },
    wed: { enabled: true, start: '09:00', end: '18:00' },
    thu: { enabled: true, start: '09:00', end: '18:00' },
    fri: { enabled: true, start: '09:00', end: '18:00' },
    sat: { enabled: false, start: '09:00', end: '18:00' },
    sun: { enabled: false, start: '09:00', end: '18:00' },
  };
}
// localStorage 復元用。保存形式の変化・手動破損・別バージョンのタブでの書き込み等で
// 形が崩れていた場合にクラッシュせず安全にデフォルト値へフォールバックするための検証。
function isValidDayHours(v: unknown): v is DayHours {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.enabled === 'boolean' &&
    typeof d.start === 'string' &&
    /^\d{2}:\d{2}$/.test(d.start) &&
    typeof d.end === 'string' &&
    /^\d{2}:\d{2}$/.test(d.end)
  );
}

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
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
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
  const [aiContext, setAiContext] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const generateTitles = useCallback(async () => {
    setAiLoading(true);
    setAiSuggestions([]);
    try {
      const res = await fetch('/api/title/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: aiContext, count: 5 }),
      });
      const data = (await res.json()) as { titles: string[] };
      setAiSuggestions(data.titles ?? []);
    } catch {
      /* noop */
    } finally {
      setAiLoading(false);
    }
  }, [aiContext]);
  const [adjType, setAdjType] = useState<'T2' | 'T3'>('T2');
  const [duration, setDuration] = useState(60);
  const [periodStart, setPeriodStart] = useState(plusDaysIso(1));
  const [periodEnd, setPeriodEnd] = useState(plusDaysIso(30));
  // 終了日プリセット：開始日から N 日後 ／ 来週末（次の日曜まで＋7日）
  function setEndOffsetDays(days: number) {
    const base = jstDateMs(periodStart);
    const target = new Date(base + days * 24 * 60 * 60 * 1000);
    setPeriodEnd(msToJstYmd(target.getTime()));
  }
  function setEndNextWeekend() {
    // 「来週末」＝開始日が含まれる週の次の週の日曜（JST）
    const baseMs = jstDateMs(periodStart);
    const dowJa = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(baseMs));
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dowMap[dowJa] ?? 0;
    // 今週の日曜まで (7 - dow) 日。来週末＝今週日曜 + 7日。0(日)なら +7
    const daysUntilNextSun = dow === 0 ? 7 : 7 - dow + 7;
    const target = baseMs + daysUntilNextSun * 24 * 60 * 60 * 1000;
    setPeriodEnd(msToJstYmd(target));
  }
  const [weeklyHours, setWeeklyHours] = useState<Record<DayKey, DayHours>>(defaultWeeklyHours());
  // 週の中で有効な曜日の中の最速開始/最遅終了（ドラッグ境界クランプの全体上限として使う。個別の枠は hoursForYmd で曜日別に取る）
  const whStart = useMemo(() => {
    const enabled = DAY_KEYS.filter((k) => weeklyHours[k].enabled);
    return enabled.length ? enabled.map((k) => weeklyHours[k].start).sort()[0]! : '09:00';
  }, [weeklyHours]);
  const whEnd = useMemo(() => {
    const enabled = DAY_KEYS.filter((k) => weeklyHours[k].enabled);
    return enabled.length ? enabled.map((k) => weeklyHours[k].end).sort().slice(-1)[0]! : '18:00';
  }, [weeklyHours]);
  // 指定日(YYYY-MM-DD)の曜日の営業時間を返す。休みの日は null。
  const hoursForYmd = useCallback(
    (ymd: string): { start: string; end: string } | null => {
      const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
      const key = WEEKDAY_TO_KEY[dow]!;
      const h = weeklyHours[key];
      return h.enabled ? { start: h.start, end: h.end } : null;
    },
    [weeklyHours],
  );
  // API に渡す WorkingHours 形式（7曜日を個別指定。休みの曜日は空配列）
  const buildWorkingHoursPayload = useCallback(() => {
    const out: Record<string, string[]> = { tz: 'Asia/Tokyo' } as unknown as Record<string, string[]>;
    for (const k of DAY_KEYS) {
      out[k] = weeklyHours[k].enabled ? [weeklyHours[k].start, weeklyHours[k].end] : [];
    }
    return out as unknown as { tz: string } & Record<DayKey, string[]>;
  }, [weeklyHours]);
  const [bufBefore, setBufBefore] = useState(0);
  const [bufAfter, setBufAfter] = useState(10);
  const [minNotice, setMinNotice] = useState(60);
  // 直前ブロックの方式：'prev10'＝対象日の前日10:00を過ぎたら不可（既定）／'minutes'＝従来の現在からN分前
  const [cutoffMode, setCutoffMode] = useState<'prev10' | 'minutes'>('prev10');
  useEffect(() => {
    try {
      const v = localStorage.getItem('schedule-relay:propose-cutoff-mode');
      if (v === 'prev10' || v === 'minutes') setCutoffMode(v);
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('schedule-relay:propose-cutoff-mode', cutoffMode); } catch { /* noop */ }
  }, [cutoffMode]);
  const [maxSlots, setMaxSlots] = useState(50);

  // 「今回の設定を保存する」チェックボックス：ON時は下記フォーム設定一式を localStorage に保存し、
  // 次回このページを開いたときに自動復元する（社長要望「毎回設定するのがめんどくさい」）。
  // 期間・タイトルは開くたびに変わるものなので保存対象から外す。
  const SAVED_SETTINGS_KEY = 'schedule-relay:propose-saved-settings';
  const [saveSettings, setSaveSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as {
          adjType?: 'T2' | 'T3';
          duration?: number;
          weeklyHours?: Record<DayKey, DayHours>;
          bufBefore?: number;
          bufAfter?: number;
          minNotice?: number;
          maxSlots?: number;
        };
        if (s.adjType === 'T2' || s.adjType === 'T3') setAdjType(s.adjType);
        if (typeof s.duration === 'number') setDuration(s.duration);
        if (s.weeklyHours && typeof s.weeklyHours === 'object') {
          const merged = defaultWeeklyHours();
          let hadInvalidKey = false;
          for (const k of DAY_KEYS) {
            const v = (s.weeklyHours as Record<string, unknown>)[k];
            if (v === undefined) continue;
            if (isValidDayHours(v)) merged[k] = v;
            else hadInvalidKey = true;
          }
          setWeeklyHours(merged);
          // 壊れたキーが1つでもあれば、破損データを持ち越さず保存をクリアする
          // （リロードのたびに同じ破損値が復元されるのを防ぐ）。
          if (hadInvalidKey) localStorage.removeItem(SAVED_SETTINGS_KEY);
        }
        if (typeof s.bufBefore === 'number') setBufBefore(s.bufBefore);
        if (typeof s.bufAfter === 'number') setBufAfter(s.bufAfter);
        if (typeof s.minNotice === 'number') setMinNotice(s.minNotice);
        if (typeof s.maxSlots === 'number') setMaxSlots(s.maxSlots);
        setSaveSettings(true);
      }
    } catch {
      /* noop */
    } finally {
      setSettingsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!settingsLoaded) return; // 復元処理が終わる前に「未保存状態」で上書きしてしまうのを防ぐ
    try {
      if (saveSettings) {
        localStorage.setItem(
          SAVED_SETTINGS_KEY,
          JSON.stringify({ adjType, duration, weeklyHours, bufBefore, bufAfter, minNotice, maxSlots }),
        );
      } else {
        localStorage.removeItem(SAVED_SETTINGS_KEY);
      }
    } catch {
      /* noop */
    }
  }, [settingsLoaded, saveSettings, adjType, duration, weeklyHours, bufBefore, bufAfter, minNotice, maxSlots]);

  // カレンダー
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCals, setSelectedCals] = useState<Set<string>>(new Set());
  const [loadingCals, setLoadingCals] = useState(true);

  // 抽出結果
  const [rawSlots, setRawSlots] = useState<SlotDto[]>([]);
  // cutoffMode === 'prev10' のときは「対象日の前日10:00 JSTを過ぎた候補」を除外
  const slots = useMemo<SlotDto[]>(() => {
    if (cutoffMode !== 'prev10') return rawSlots;
    const now = Date.now();
    return rawSlots.filter((s) => {
      const startMs = Date.parse(s.start);
      const ymd = msToJstYmd(startMs);
      const dayStartMs = jstDateMs(ymd);
      const prevDay10amMs = dayStartMs - 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000;
      return now <= prevDay10amMs;
    });
  }, [rawSlots, cutoffMode]);
  const [busyByCalendar, setBusyByCalendar] = useState<BusyByCalendar>({});
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const selectedSlotsRef = useRef<Set<number>>(new Set());
  useEffect(() => { selectedSlotsRef.current = selectedSlots; }, [selectedSlots]);
  // ドラッグ移動／下端リサイズで変更された候補の上書き値（インデックス→新start/end ISO）
  // 既存slotsを直接変えず、表示・送信時にこのMapで上書き反映する。
  const [slotOverrides, setSlotOverrides] = useState<Record<number, { start: string; end: string }>>({});
  // 現在ドラッグ中の候補グループ key（ハイライト用）。null=なし
  // key = グループ内 idx をソートして '_' join したもの（例 "3_5_7"）
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  // ドラッグの一時状態（高頻度更新のたびにstateを書かないため ref で保持）
  // グループ単位でドラッグ。idxs はグループ内の全 slot index、tailIdx は末尾（resize対象）
  const dragRef = useRef<{
    idxs: number[];
    tailIdx: number;
    mode: 'move' | 'resize';
    origs: Record<number, { start: number; end: number }>;
    groupOrigStartMs: number;
    groupOrigEndMs: number;
    pointerStartY: number;
    dayYmd: string;
    moved: boolean;
    invalid: boolean;
  } | null>(null);
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
  // クリックした既存予定の詳細を表示するためのポップオーバー状態
  const [selectedBusy, setSelectedBusy] = useState<{ calId: string; start: number; end: number; title?: string } | null>(null);

  // 週ナビ：表示開始週（月曜・JST ms）
  // 初期表示は「期間開始日が含まれる週」（今日の週がまだ期間に入っていない場合の白紙画面を避ける）
  const [viewWeekStart, setViewWeekStart] = useState<number>(() => startOfWeekJst(jstDateMs(plusDaysIso(1))));
  // 表示モード（Spirと同じ：1日／3日／1週間切替）
  const [viewMode, setViewMode] = useState<'day' | '3days' | 'week'>('week');
  useEffect(() => {
    try {
      const v = localStorage.getItem('schedule-relay:propose-view-mode');
      if (v === 'day' || v === '3days' || v === 'week') setViewMode(v);
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('schedule-relay:propose-view-mode', viewMode); } catch { /* noop */ }
  }, [viewMode]);
  const daysToShow = viewMode === 'day' ? 1 : viewMode === '3days' ? 3 : 7;
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
          // 初回は全カレンダーを選択（香奈カレンダー等も自動で含める）
          for (const c of cals) init.add(c.id);
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
    const enabledDays = DAY_KEYS.filter((k) => weeklyHours[k].enabled);
    const allValid = enabledDays.length > 0 && enabledDays.every((k) => weeklyHours[k].start < weeklyHours[k].end);
    return periodStart < periodEnd && allValid && !extracting;
  }, [title, periodStart, periodEnd, weeklyHours, extracting]);

  // 自動抽出：初回ロード後＋設定変更時に自動で候補を抽出（社長指摘
  // 「候補を自動抽出押さなくても自動で最初から抽出出来る？」）。
  // debounce 400ms で連続変更時の過剰APIコールを抑制。
  // extracting中・loadingCals中・canExtract不可・カレンダー連携無効時は何もしない。
  useEffect(() => {
    if (loadingCals || extracting || !canExtract) return;
    const t = setTimeout(() => {
      // 最新の extract を呼ぶ（依存配列で関数参照は最新が保証される）
      extract();
    }, 400);
    return () => clearTimeout(t);
    // 設定変更で自動再抽出する依存。selectedCals は Set なのでサイズと内容で監視
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCals, periodStart, periodEnd, duration, weeklyHours, bufBefore, bufAfter, minNotice, maxSlots, selectedCals, cutoffMode]);

  // カレンダーID → 色 マップ
  const calColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.backgroundColor || '#9ca3af');
    return m;
  }, [calendars]);

  // カレンダーID → 表示名 マップ（既存予定クリック時の詳細表示用）
  const calNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.summary);
    return m;
  }, [calendars]);

  async function extract() {
    setExtracting(true);
    setExtractErr(null);
    setRawSlots([]);
    setBusyByCalendar({});
    setSelectedSlots(new Set());
    try {
      // 今日の週の月曜日からbusyを取得（期間前の今週の予定もカレンダーに表示するため）
      const todayWeekMs = startOfWeekJst(Date.now());
      const busyFrom = msToJstYmd(Math.min(todayWeekMs, jstDateMs(periodStart)));
    const body = {
        calendarIds: Array.from(selectedCals),
        periodStart: new Date(`${busyFrom}T00:00:00+09:00`).toISOString(),
        periodEnd: new Date(`${periodEnd}T23:59:59+09:00`).toISOString(),
        durationMinutes: duration,
        workingHours: buildWorkingHoursPayload(),
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
      if (!res.ok) {
        // レスポンスがJSONでない場合（504等、アプリコード外で切られたケース）もステータスは分かるようにする。
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || `抽出に失敗しました（HTTP ${res.status}）`);
      }
      const data = await res.json();
      const got: SlotDto[] = data.slots ?? [];
      setRawSlots(got);
      setBusyByCalendar((data.busyByCalendar ?? {}) as BusyByCalendar);
      // 既定で全件選択
      setSelectedSlots(new Set(got.map((_, i) => i)));
    } catch (e) {
      setExtractErr(e instanceof Error ? e.message : '抽出に失敗しました');
    } finally {
      setExtracting(false);
    }
  }

  async function applySelected() {
    setApplyErr(null);
    setApplying(true);
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
        working_hours: buildWorkingHoursPayload(),
      };
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // organizerId は送らない（サーバがセッションから決める）
        body: JSON.stringify({ type: adjType, slug, settings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || '作成に失敗しました');
      const origin = window.location.origin;
      const url = `${origin}/b/${slug}`;
      setDoneUrl(url);
      if (adjType === 'T3') {
        setDoneVoteUrl(`${origin}/v/${data.page?.id ?? slug}`);
      }
      // メール本文用テキスト（ドラッグ/リサイズで動かした候補は effectiveSlots に反映済み）
      const lines = Array.from(selectedSlots)
        .sort((a, b) => a - b)
        .map((i) => effectiveSlots[i])
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

  // アクティブな候補スロットをクリックで完全削除（rawSlotsから除去して空の状態に戻す）
  function deleteSlot(i: number) {
    const slotToDelete = slots[i];
    if (!slotToDelete) return;
    const startKey = slotToDelete.start;
    setRawSlots((prev) => prev.filter((s) => s.start !== startKey));
    setSelectedSlots((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx === i) continue;
        next.add(idx > i ? idx - 1 : idx);
      }
      return next;
    });
    setSlotOverrides((prev) => {
      const next: Record<number, SlotDto> = {};
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      }
      return next;
    });
  }

  // 表示週の各日 YMD（月-日）
  const weekDays = useMemo(() => {
    const out: { ms: number; ymd: string; dowJa: string; day: number; isToday: boolean; outOfPeriod: boolean }[] = [];
    const todayYmd = msToJstYmd(Date.now());
    const periodStartMs = jstDateMs(periodStart);
    const periodEndMs = jstDateMs(periodEnd);
    for (let i = 0; i < daysToShow; i++) {
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
  }, [viewWeekStart, periodStart, periodEnd, daysToShow]);

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

  // 表示週・各日に該当する候補（override 反映済）
  const candForDay = useMemo(() => {
    return (ymd: string): { idx: number; start: number; end: number }[] => {
      const dayStart = jstDateMs(ymd);
      const dayEnd = addDays(dayStart, 1);
      const out: { idx: number; start: number; end: number }[] = [];
      slots.forEach((s, i) => {
        const ov = slotOverrides[i];
        const sMs = Date.parse(ov?.start ?? s.start);
        const eMs = Date.parse(ov?.end ?? s.end);
        if (eMs <= dayStart || sMs >= dayEnd) return;
        out.push({ idx: i, start: sMs, end: eMs });
      });
      return out;
    };
  }, [slots, slotOverrides]);

  // ドラッグ／リサイズ：mousedown→window mousemove/mouseup（グループ単位）
  // - move: グループ内の全 slot を同じ deltaMs で平行移動
  // - resize: グループの末尾 slot（end が最大）の end だけを延長／短縮
  const startPointerDrag = useCallback(
    (
      e: React.PointerEvent,
      idxs: number[],
      tailIdx: number,
      mode: 'move' | 'resize',
      dayYmd: string,
      groupOrigStartMs: number,
      groupOrigEndMs: number,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      // グループ内 slot の orig (start,end) を記録（move 時に全員へ delta を適用するため）
      const origs: Record<number, { start: number; end: number }> = {};
      for (const i of idxs) {
        const s = slots[i];
        if (!s) continue;
        const ov = slotOverrides[i];
        origs[i] = {
          start: Date.parse(ov?.start ?? s.start),
          end: Date.parse(ov?.end ?? s.end),
        };
      }
      const groupKey = [...idxs].sort((a, b) => a - b).join('_');
      dragRef.current = {
        idxs,
        tailIdx,
        mode,
        origs,
        groupOrigStartMs,
        groupOrigEndMs,
        pointerStartY: e.clientY,
        dayYmd,
        moved: false,
        invalid: false,
      };
      setDraggingGroupKey(groupKey);

      // その日の busy（他候補 + busy）を収集（衝突判定用）。グループ内 slot は除外
      const dayStartMs = jstDateMs(dayYmd);
      const dayEndMs = addDays(dayStartMs, 1);
      const dayHours = hoursForYmd(dayYmd) ?? { start: whStart, end: whEnd };
      const whStartMs = new Date(`${dayYmd}T${dayHours.start}:00+09:00`).getTime();
      const whEndMs = new Date(`${dayYmd}T${dayHours.end}:00+09:00`).getTime();

      const busiesSameDay: { start: number; end: number }[] = [];
      for (const calId of Object.keys(busyByCalendar)) {
        for (const b of busyByCalendar[calId] ?? []) {
          const s = Date.parse(b.start);
          const en = Date.parse(b.end);
          if (en <= dayStartMs || s >= dayEndMs) continue;
          busiesSameDay.push({ start: s, end: en });
        }
      }
      const groupIdxSet = new Set(idxs);
      const otherCandsSameDay: { start: number; end: number }[] = [];
      slots.forEach((s, i) => {
        if (groupIdxSet.has(i)) return;
        const ov = slotOverrides[i];
        const sMs = Date.parse(ov?.start ?? s.start);
        const eMs = Date.parse(ov?.end ?? s.end);
        if (eMs <= dayStartMs || sMs >= dayEndMs) return;
        otherCandsSameDay.push({ start: sMs, end: eMs });
      });
      const conflictTargets = [...busiesSameDay, ...otherCandsSameDay];

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const deltaPx = ev.clientY - cur.pointerStartY;
        if (Math.abs(deltaPx) >= 3) cur.moved = true;
        const deltaMin = (deltaPx / SLOT_PX) * 60;
        const deltaMs = deltaMin * 60_000;

        // 営業時間境界（候補は WH 内に収まる前提）
        const lower = Math.max(dayStartMs, whStartMs);
        const upper = Math.min(dayEndMs, whEndMs);

        if (cur.mode === 'move') {
          // グループ全体に同じ deltaMs を適用。グループの (start,end) で境界クランプ。
          const groupRange = moveRange(
            { start: cur.groupOrigStartMs, end: cur.groupOrigEndMs },
            deltaMs,
            lower,
            upper,
            15,
          );
          // 実際に動いた量（クランプ後）を各 slot に適用
          const appliedDelta = groupRange.start - cur.groupOrigStartMs;
          cur.invalid = hasConflict(groupRange, conflictTargets);
          setSlotOverrides((prev) => {
            const nextOv = { ...prev };
            for (const i of cur.idxs) {
              const o = cur.origs[i];
              if (!o) continue;
              const ns = o.start + appliedDelta;
              const ne = o.end + appliedDelta;
              nextOv[i] = {
                start: new Date(ns).toISOString(),
                end: new Date(ne).toISOString(),
              };
            }
            return nextOv;
          });
        } else {
          // リサイズ：末尾 slot の end だけを延長／短縮（方式A）
          const tailOrig = cur.origs[cur.tailIdx];
          if (!tailOrig) return;
          const maxEnd = nextBusyStart(
            { start: cur.groupOrigStartMs, end: cur.groupOrigEndMs },
            conflictTargets,
          );
          const next = resizeEnd(
            { start: tailOrig.start, end: tailOrig.end },
            deltaMs,
            upper,
            duration * 60_000,
            15,
            maxEnd,
          );
          // 衝突判定はグループ全体（start = groupOrigStart, end = next.end）で
          cur.invalid = hasConflict(
            { start: cur.groupOrigStartMs, end: next.end },
            conflictTargets,
          );
          setSlotOverrides((prev) => ({
            ...prev,
            [cur.tailIdx]: {
              start: new Date(next.start).toISOString(),
              end: new Date(next.end).toISOString(),
            },
          }));
        }
      };

      const onUp = () => {
        const cur = dragRef.current;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!cur) return;
        // 衝突状態で離したら元に戻す（赤枠で弾く）
        if (cur.invalid) {
          setSlotOverrides((prev) => {
            const next = { ...prev };
            const targetIdxs = cur.mode === 'resize' ? [cur.tailIdx] : cur.idxs;
            for (const i of targetIdxs) {
              const o = cur.origs[i];
              const s = slots[i];
              if (!o || !s) continue;
              // 元の slot と orig が一致していれば override を消す
              if (Date.parse(s.start) === o.start && Date.parse(s.end) === o.end) {
                delete next[i];
              } else {
                next[i] = {
                  start: new Date(o.start).toISOString(),
                  end: new Date(o.end).toISOString(),
                };
              }
            }
            return next;
          });
        }
        // クリック扱い（3px未満）なら、グループ内 全 slot を一括選択／解除
        if (!cur.moved && cur.mode === 'move') {
          const allOn = cur.idxs.every((i) => selectedSlotsRef.current.has(i));
          if (allOn) {
            // アクティブ状態でクリック → rawSlotsから完全削除（空の状態に戻す）
            // 大きいインデックスから削除してインデックスのズレを防ぐ
            const sortedDesc = [...cur.idxs].sort((a, b) => b - a);
            for (const i of sortedDesc) {
              const slotToDelete = slots[i];
              if (!slotToDelete) continue;
              const startKey = slotToDelete.start;
              setRawSlots((prev) => prev.filter((s) => s.start !== startKey));
              setSelectedSlots((prev) => {
                const ns = new Set<number>();
                for (const idx of prev) {
                  if (idx === i) continue;
                  ns.add(idx > i ? idx - 1 : idx);
                }
                return ns;
              });
              setSlotOverrides((prev) => {
                const next: Record<number, SlotDto> = {};
                for (const [k, v] of Object.entries(prev)) {
                  const idx = Number(k);
                  if (idx < i) next[idx] = v;
                  else if (idx > i) next[idx - 1] = v;
                }
                return next;
              });
            }
          } else {
            setSelectedSlots((prev) => {
              const ns = new Set(prev);
              for (const i of cur.idxs) ns.add(i);
              return ns;
            });
          }
        }
        dragRef.current = null;
        setDraggingGroupKey(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [busyByCalendar, slots, slotOverrides, weeklyHours, hoursForYmd, whStart, whEnd, duration],
  );

  // /api/pages 送信用：override を反映した slot 配列
  // （現状の applySelected はメール本文しか slots を使わないが、将来の送信ペイロードにも使う）
  const effectiveSlots = useMemo<SlotDto[]>(() => {
    return slots.map((s, i) => {
      const ov = slotOverrides[i];
      if (ov) return { start: ov.start, end: ov.end };
      return s;
    });
  }, [slots, slotOverrides]);

  return (
    <div className="sc-wrap">
      <div className="sc-topbar">
        <div className="sc-logo"><span className="mk">📅</span>スケ調くん</div>
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
              <label>タイトル<span className="opt">（任意）</span></label>
              <input className="sc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="未入力なら「日程候補」になります" />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  className="sc-input"
                  style={{ flex: 1, fontSize: 12 }}
                  value={aiContext}
                  onChange={(e) => setAiContext(e.target.value)}
                  placeholder="ヒント例：Eight・名刺・採用・〇〇さん"
                  onKeyDown={(e) => e.key === 'Enter' && generateTitles()}
                />
                <button
                  className="sc-btn-sm"
                  onClick={generateTitles}
                  disabled={aiLoading}
                  style={{ whiteSpace: 'nowrap', fontSize: 12 }}
                >
                  {aiLoading ? '生成中…' : '✨ AI生成'}
                </button>
              </div>
              {aiSuggestions.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {aiSuggestions.map((s, i) => (
                    <button
                      key={i}
                      className="sc-btn-sm"
                      style={{ textAlign: 'left', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
                      onClick={() => { setTitle(s); setAiSuggestions([]); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
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
              <div className="pp-period-presets">
                <button type="button" onClick={() => setEndOffsetDays(3)}>3日後</button>
                <button type="button" onClick={() => setEndOffsetDays(5)}>5日後</button>
                <button type="button" onClick={() => setEndOffsetDays(7)}>1週間後</button>
                <button type="button" onClick={setEndNextWeekend}>来週末</button>
                <button type="button" onClick={() => setEndOffsetDays(14)}>2週間後</button>
                <button type="button" onClick={() => setEndOffsetDays(21)}>3週間後</button>
                <button type="button" onClick={() => setEndOffsetDays(30)}>1ヶ月後</button>
              </div>
            </div>

            <div className="sc-field">
              <label>
                営業時間（曜日ごと）
                <button
                  type="button"
                  className="sc-btn-sm"
                  style={{ marginLeft: 8, fontSize: 11 }}
                  onClick={() => {
                    // 平日(月〜金)を1行目(月)の値で一括揃える
                    setWeeklyHours((prev) => {
                      const base = prev.mon;
                      const next = { ...prev };
                      (['mon', 'tue', 'wed', 'thu', 'fri'] as DayKey[]).forEach((k) => {
                        next[k] = { ...base };
                      });
                      return next;
                    });
                  }}
                >
                  月の設定を平日に一括コピー
                </button>
              </label>
              <div className="sc-weekly-hours">
                {DAY_KEYS.map((k) => {
                  const h = weeklyHours[k];
                  return (
                    <div key={k} className="sc-weekly-hours-row">
                      <label className="sc-weekly-hours-day">
                        <input
                          type="checkbox"
                          checked={h.enabled}
                          onChange={(e) =>
                            setWeeklyHours((prev) => ({ ...prev, [k]: { ...prev[k], enabled: e.target.checked } }))
                          }
                        />
                        {DAY_LABELS[k]}
                      </label>
                      <input
                        className="sc-input"
                        type="time"
                        disabled={!h.enabled}
                        value={h.start}
                        onChange={(e) => setWeeklyHours((prev) => ({ ...prev, [k]: { ...prev[k], start: e.target.value } }))}
                      />
                      <span className="sc-weekly-hours-sep">〜</span>
                      <input
                        className="sc-input"
                        type="time"
                        disabled={!h.enabled}
                        value={h.end}
                        onChange={(e) => setWeeklyHours((prev) => ({ ...prev, [k]: { ...prev[k], end: e.target.value } }))}
                      />
                      {h.enabled && h.start >= h.end && (
                        <span className="sc-weekly-hours-err">開始は終了より前にしてください</span>
                      )}
                    </div>
                  );
                })}
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
              <select
                className="sc-select"
                value={cutoffMode === 'prev10' ? 'prev10' : String(minNotice)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'prev10') setCutoffMode('prev10');
                  else { setCutoffMode('minutes'); setMinNotice(Number(v)); }
                }}
              >
                <option value="prev10">前日10時まで（既定）</option>
                <option value="0">直前まで（無し）</option>
                <option value="30">30分前まで</option>
                <option value="60">60分前まで</option>
                <option value="120">2時間前まで</option>
                <option value="240">4時間前まで</option>
                <option value="1440">24時間前まで</option>
              </select>
            </div>

            <div className="sc-field">
              <label>抽出件数</label>
              <select className="sc-select" value={maxSlots} onChange={(e) => setMaxSlots(Number(e.target.value))}>
                {[10, 20, 30, 50, 100, 200].map((m) => <option key={m} value={m}>{m}件</option>)}
              </select>
            </div>

            <label className="sc-save-settings">
              <input type="checkbox" checked={saveSettings} onChange={(e) => setSaveSettings(e.target.checked)} />
              今回の設定（調整タイプ・打合せ時間・営業時間・バッファ・直前ブロック・抽出件数）を保存する
            </label>

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
                <button className="pp-cal-today" onClick={() => setViewWeekStart(viewMode === 'week' ? startOfWeekJst(Date.now()) : jstDateMs(todayIso()))}>今日</button>
                <button className="pp-cal-arrow" onClick={() => setViewWeekStart((v) => addDays(v, -daysToShow))} aria-label="前へ">&lt;</button>
                <button className="pp-cal-arrow" onClick={() => setViewWeekStart((v) => addDays(v, daysToShow))} aria-label="次へ">&gt;</button>
                <span className="pp-cal-month">{viewMonthLabel}</span>
                <div className="pp-cal-viewmode" role="tablist" aria-label="表示モード">
                  <button className={viewMode === 'day' ? 'on' : ''} onClick={() => setViewMode('day')} role="tab">1日</button>
                  <button className={viewMode === '3days' ? 'on' : ''} onClick={() => setViewMode('3days')} role="tab">3日</button>
                  <button className={viewMode === 'week' ? 'on' : ''} onClick={() => setViewMode('week')} role="tab">週</button>
                </div>
                <span className="pp-cal-spacer" />
                {slots.length > 0 && (
                  <span className="pp-cal-count">候補 {selectedSlots.size}/{slots.length} 件</span>
                )}
              </div>

              <div className={`pp-cal-grid${viewMode === 'day' ? ' day' : viewMode === '3days' ? ' days3' : ''}`} role="grid" aria-label="カレンダー">
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
                              className="pp-cal-busy pp-cal-busy-clickable"
                              style={{ top, height, background: hexToRgba(color, 0.28), borderColor: hexToRgba(color, 0.5), borderLeft: `3px solid ${color}` }}
                              title={b.title || '予定あり'}
                              onClick={(e) => { e.stopPropagation(); setSelectedBusy(b); }}
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
                        {/* 候補ブロック：連続/重なる候補を1グループに統合して1つの大きな
                            青点線ブロックとして描画（Spirと同じUX）。
                            - クリック（移動量<3px）：グループ内全 slot を一括選択／解除
                            - ドラッグ：グループ全体を平行移動
                            - 下端リサイズ：グループ末尾 slot の end のみ延長／短縮 */}
                        {groupSlots(cand).map((g) => {
                          const top = msToTopPx(g.start, d.ymd);
                          const height = durationMsToHeightPx(g.start, g.end, d.ymd);
                          if (height <= 0) return null;
                          const groupKey = [...g.idxs].sort((a, b) => a - b).join('_');
                          const on = g.idxs.every((i) => selectedSlots.has(i));
                          const isDragging = draggingGroupKey === groupKey;
                          const invalid = isDragging && dragRef.current?.invalid;
                          const startStr = new Date(g.start).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                          const endStr = new Date(g.end).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
                          const countLabel = '候補';
                          return (
                            <div
                              key={`g${groupKey}`}
                              className={`pp-cal-cand ${on ? 'on' : ''}${isDragging ? ' dragging' : ''}${invalid ? ' invalid' : ''}`}
                              style={{ top, height }}
                              onPointerDown={(e) => startPointerDrag(e, g.idxs, g.tailIdx, 'move', d.ymd, g.start, g.end)}
                              title={on ? `${startStr}-${endStr}（クリックで削除・ドラッグで移動）` : `${startStr}-${endStr}（クリックで選択・ドラッグで移動）`}
                            >
                              <div className="pp-cal-cand-time">{startStr}-{endStr}</div>
                              <div className="pp-cal-cand-label">{countLabel}</div>
                              <div
                                className="pp-cal-cand-resize"
                                onPointerDown={(e) => startPointerDrag(e, g.idxs, g.tailIdx, 'resize', d.ymd, g.start, g.end)}
                                title="ドラッグで時間を延長／短縮"
                              />
                            </div>
                          );
                        })}
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
      {selectedBusy && (
        <div className="pp-busy-modal-overlay" onClick={() => setSelectedBusy(null)}>
          <div className="pp-busy-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="pp-busy-modal-close"
              aria-label="閉じる"
              onClick={() => setSelectedBusy(null)}
            >
              ✕
            </button>
            <div className="pp-busy-modal-title">{selectedBusy.title || '(タイトルなし)'}</div>
            <div className="pp-busy-modal-time">
              {new Date(selectedBusy.start).toLocaleDateString('ja-JP', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' })}
              {'　'}
              {new Date(selectedBusy.start).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })}
              〜
              {new Date(selectedBusy.end).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            <div className="pp-busy-modal-cal">
              <span
                className="pp-busy-modal-cal-dot"
                style={{ background: calColorMap.get(selectedBusy.calId) || '#9ca3af' }}
              />
              {calNameMap.get(selectedBusy.calId) || 'カレンダー'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
