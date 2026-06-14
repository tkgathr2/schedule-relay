'use client';
/**
 * /propose — Spirの「候補を自動抽出」相当の3カラムUI。
 * 左：設定（タイトル・調整タイプT2/T3・打合せ時間・期間・営業時間・バッファ）
 * 中：予定を考慮するカレンダー（複数選択）
 * 右：抽出結果（チェック→「この候補を反映」で予約ページ作成）
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

const TZ = 'Asia/Tokyo';

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
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string | null>(null);

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
        // 既定で primary にチェック
        const init = new Set<string>();
        for (const c of cals) if (c.primary) init.add(c.id);
        if (init.size === 0 && cals.length > 0) init.add(cals[0]!.id);
        setSelectedCals(init);
      } catch {
        setCalendars([]);
      } finally {
        setLoadingCals(false);
      }
    })();
  }, []);

  const canExtract = useMemo(() => {
    return title.trim().length > 0 && periodStart < periodEnd && whStart < whEnd && !extracting;
  }, [title, periodStart, periodEnd, whStart, whEnd, extracting]);

  async function extract() {
    setExtracting(true);
    setExtractErr(null);
    setSlots([]);
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
      // 既定で全件選択
      setSelectedSlots(new Set(got.map((_, i) => i)));
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
        title: title.trim(),
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
          `${title.trim()} の候補です。`,
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
                title: title.trim(),
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
        <div className="sc-propose">
          {/* 左ペイン：設定 */}
          <aside className="pp-left">
            <h2>候補を自動抽出</h2>
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
          </aside>

          {/* 中ペイン：カレンダー選択 */}
          <section className="pp-mid">
            <h3>予定を考慮するカレンダー</h3>
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
          </section>

          {/* 右ペイン：抽出結果 */}
          <section className="pp-right">
            <h3>抽出された候補</h3>
            {slots.length === 0 ? (
              <div style={{ fontSize: 13, color: '#6b7280', padding: 12, background: '#fafafa', borderRadius: 8 }}>
                「候補を自動抽出」を押すと、ここに候補が表示されます。
              </div>
            ) : (
              <>
                <div className="pp-slots">
                  {slots.map((s, i) => {
                    const on = selectedSlots.has(i);
                    return (
                      <label key={i} className={`pp-slot ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleSlot(i)} />
                        <span>{fmtSlotJa(s.start, s.end)}</span>
                      </label>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                  反映する候補: {selectedSlots.size} / {slots.length} 件
                </div>
                <button
                  className="sc-btn primary"
                  style={{ width: '100%', marginTop: 12 }}
                  disabled={selectedSlots.size === 0 || applying}
                  onClick={applySelected}
                >
                  {applying ? '反映中…' : 'この候補を反映'}
                </button>
                {applyErr && <div className="sc-err" style={{ marginTop: 10 }}>{applyErr}</div>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
