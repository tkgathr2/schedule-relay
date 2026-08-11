'use client';
/**
 * /unconfirmed — 未確定の調整一覧（Spir同等）。
 * GET /api/events?status=open|holding をデータ源にテーブル表示。
 */
import { useCallback, useEffect, useState } from 'react';

type PageSettings = {
  title?: string;
  duration_minutes?: number;
  participants?: string[];
  min_notice_minutes?: number;
  buffer_minutes?: { before?: number; after?: number };
  working_hours?: Record<string, unknown>;
} | null;

type PageMeta = {
  id: string;
  slug: string;
  organizerId: string;
  settings: PageSettings;
} | null;

type EventRow = {
  id: string;
  pageId: string;
  type: string;
  status: string;
  createdAt: number;
  page: PageMeta;
};

// /api/pages の生レスポンス形（T2〜T6のうち、相手がまだ一度もリンクを開いておらず
// Event が存在しないものを「送信済み・未接触」として一覧に混ぜ込むために使う）
type PageRow = {
  id: string;
  type: string;
  slug: string;
  isActive: boolean;
  settings: PageSettings;
  createdAt: number;
};

function fmtDuration(min?: number): string {
  if (!min) return '未設定';
  return `${min}分`;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'open': return '相手が閲覧中';
    case 'holding': return '仮押さえ中';
    case 'pending': return '送信済み・未クリック';
    default: return s;
  }
}

// 編集フォーム（営業時間・曜日ごと）用の型・ユーティリティ。
// settings.working_hours は propose と同じ形 { tz, mon:[start,end]|[], ... } で保存されている。
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<DayKey, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
type DayHours = { enabled: boolean; start: string; end: string };

function parseWorkingHours(wh: unknown): Record<DayKey, DayHours> {
  const obj = wh && typeof wh === 'object' ? (wh as Record<string, unknown>) : {};
  const out = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS) {
    const v = obj[k];
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') {
      out[k] = { enabled: true, start: v[0], end: v[1] };
    } else {
      out[k] = { enabled: false, start: '09:00', end: '18:00' };
    }
  }
  return out;
}

function buildWorkingHoursPayload(hours: Record<DayKey, DayHours>): Record<string, unknown> {
  const out: Record<string, unknown> = { tz: 'Asia/Tokyo' };
  for (const k of DAY_KEYS) out[k] = hours[k].enabled ? [hours[k].start, hours[k].end] : [];
  return out;
}

const TZ = 'Asia/Tokyo';
const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function fmtSlotJa(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const md = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, month: 'numeric', day: 'numeric' }).format(s);
  const dow = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, weekday: 'short' }).format(s);
  const sh = s.toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const eh = e.toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${md}（${dow}） ${sh}〜${eh}`;
}

// 「テキストで送る」本文：タイトル・打合せ時間に加えて、実際の空き候補日時を具体的に列挙する。
// 相手は①〜の番号でこのメッセージに返信して選ぶか、リンクから自分で選ぶか、どちらでも良いようにする
// （社長要望：日程・打合せ時間を具体的にテキストで書き、テキスト返信/リンクの両方を選べるようにする）。
async function buildMessageText(row: EventRow, origin: string): Promise<string> {
  const title = row.page?.settings?.title || '日程調整';
  const duration = row.page?.settings?.duration_minutes;
  const slug = row.page?.slug;
  const url = slug ? `${origin}/b/${slug}` : '';

  let candidateLines: string[] = [];
  if (slug) {
    try {
      const res = await fetch(`/api/pages/${slug}/availability`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { slots?: { start: string; end: string }[] };
        candidateLines = (data.slots || [])
          .slice(0, 5)
          .map((s, i) => `${CIRCLED_NUMS[i] ?? `${i + 1}.`} ${fmtSlotJa(s.start, s.end)}`);
      }
    } catch {
      /* 取得失敗時は候補列挙を諦め、リンクのみの本文にフォールバック */
    }
  }

  const lines = [`${title} の日程調整です${duration ? `（所要${duration}分）` : ''}。`, ''];
  if (candidateLines.length > 0) {
    lines.push(
      '下記の候補からご都合の良い日時をお選びいただき、このメッセージに返信いただくか、',
      'リンクから直接ご予約ください。',
      '',
      '【候補】',
      ...candidateLines,
      '',
    );
  }
  lines.push('【予約リンク】', url);
  return lines.join('\n');
}

export default function UnconfirmedPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 編集モーダル
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDuration, setEditDuration] = useState(60);
  const [editMinNotice, setEditMinNotice] = useState(60);
  const [editBufBefore, setEditBufBefore] = useState(0);
  const [editBufAfter, setEditBufAfter] = useState(10);
  const [editHours, setEditHours] = useState<Record<DayKey, DayHours>>(() => parseWorkingHours(null));
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [evRes, pgRes] = await Promise.all([
        fetch('/api/events?status=open|holding', { cache: 'no-store' }),
        fetch('/api/pages', { cache: 'no-store' }),
      ]);
      if (!evRes.ok) throw new Error(`status ${evRes.status}`);
      const evJson = (await evRes.json()) as { events: EventRow[] };
      const pageEvents = evJson.events || [];

      // T2〜T6（確定型・投票型など一回限りの調整）は、リンクを送った直後
      // ＝相手がまだ一度も開いておらず Event がまだ存在しない段階でも
      // 「送信済み・未クリック」としてここに出す（社長要望：空き時間リンクではなくこちらに出したい）。
      let pendingFromPages: EventRow[] = [];
      if (pgRes.ok) {
        const pgJson = (await pgRes.json()) as { pages: PageRow[] };
        const pageIdsWithEvent = new Set(pageEvents.map((e) => e.pageId));
        pendingFromPages = (pgJson.pages || [])
          .filter((p) => p.type !== 'T1' && p.isActive && !pageIdsWithEvent.has(p.id))
          .map((p) => ({
            id: `page-${p.id}`,
            pageId: p.id,
            type: p.type,
            status: 'pending',
            createdAt: p.createdAt,
            page: { id: p.id, slug: p.slug, organizerId: '', settings: p.settings },
          }));
      }

      const merged = [...pageEvents, ...pendingFromPages].sort((a, b) => b.createdAt - a.createdAt);
      setEvents(merged);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '読み込みに失敗しました');
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // この調整を削除する（ページを非アクティブ化＝相手のリンクも無効になる）。
  const deletePage = async (row: EventRow) => {
    const slug = row.page?.slug;
    if (!slug) return;
    const title = row.page?.settings?.title || '(無題)';
    if (!confirm(`「${title}」を削除しますか？\n相手が持っているリンクも無効になります。`)) return;
    try {
      const res = await fetch(`/api/pages/${slug}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setToast('削除しました');
      setTimeout(() => setToast(null), 1500);
      void load();
    } catch {
      setToast('削除に失敗しました');
      setTimeout(() => setToast(null), 1500);
    }
  };

  const copyLink = async (slug: string | undefined) => {
    if (!slug) return;
    const url = `${window.location.origin}/b/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast('URL をコピーしました');
      setTimeout(() => setToast(null), 1500);
    } catch {
      setToast('コピーに失敗しました');
      setTimeout(() => setToast(null), 1500);
    }
  };

  // 「テキストで送る」：タイトル・打合せ時間・具体的な候補日時＋予約リンクをまとめた本文を
  // クリップボードにコピーする（Slack/メールにそのまま貼り付けて送れる状態にする）。
  const copyMessage = async (row: EventRow) => {
    setToast('本文を作成中…');
    try {
      const text = await buildMessageText(row, window.location.origin);
      await navigator.clipboard.writeText(text);
      setToast('本文をコピーしました');
      setTimeout(() => setToast(null), 1500);
    } catch {
      setToast('コピーに失敗しました');
      setTimeout(() => setToast(null), 1500);
    }
  };

  function openEdit(row: EventRow) {
    const s = row.page?.settings;
    setEditTitle(s?.title || '');
    setEditDuration(typeof s?.duration_minutes === 'number' ? s.duration_minutes : 60);
    setEditMinNotice(typeof s?.min_notice_minutes === 'number' ? s.min_notice_minutes : 60);
    setEditBufBefore(typeof s?.buffer_minutes?.before === 'number' ? s.buffer_minutes.before : 0);
    setEditBufAfter(typeof s?.buffer_minutes?.after === 'number' ? s.buffer_minutes.after : 10);
    setEditHours(parseWorkingHours(s?.working_hours));
    setEditErr(null);
    setEditing(row);
  }

  async function saveEdit() {
    const slug = editing?.page?.slug;
    if (!slug) return;
    setEditSaving(true);
    setEditErr(null);
    try {
      const res = await fetch(`/api/pages/${slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          duration_minutes: editDuration,
          min_notice_minutes: editMinNotice,
          buffer_minutes: { before: editBufBefore, after: editBufAfter },
          working_hours: buildWorkingHoursPayload(editHours),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || '保存に失敗しました');
      setEditing(null);
      setToast('保存しました');
      setTimeout(() => setToast(null), 1500);
      void load();
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <main className="sc-list-page">
      <div className="wrap">
        <div className="sc-list-head">
          <div>
            <h1>未確定の調整</h1>
            <div className="sub">相手の返事待ち、または仮押さえ中の調整一覧です。</div>
          </div>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            読み込みエラー：{err}
          </div>
        )}

        {events === null ? (
          <div className="sc-list-card"><div className="sc-list-empty">読み込み中…</div></div>
        ) : events.length === 0 ? (
          <div className="sc-list-card">
            <div className="sc-list-empty">
              <h3>未確定の調整はありません</h3>
              <p>新しく調整を始めると、相手の返事を待っている間ここに表示されます。</p>
            </div>
          </div>
        ) : (
          <div className="sc-list-card">
            <table className="sc-list-table">
              <thead>
                <tr>
                  <th>打合せ時間</th>
                  <th>タイトル</th>
                  <th>参加者</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  // 化け文字（U+FFFD）を含むタイトルはレガシー破損データ。
                  // 元の文字列は失われているため復元できず、代替表示にする
                  // （調整自体は相手の返事待ち中の可能性があるため一覧からは消さない）。
                  const rawTitle = e.page?.settings?.title;
                  const title =
                    typeof rawTitle === 'string' && rawTitle.length > 0
                      ? rawTitle.includes('�')
                        ? '(タイトル取得不可・文字化けデータ)'
                        : rawTitle
                      : '(無題)';
                  const dur = fmtDuration(e.page?.settings?.duration_minutes);
                  const participants = e.page?.settings?.participants?.join('・') || '—';
                  return (
                    <tr key={e.id}>
                      <td>{dur}</td>
                      <td className="cell-title">
                        {title}
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280' }}>[{statusLabel(e.status)}]</span>
                      </td>
                      <td className="cell-muted">{participants}</td>
                      <td className="cell-actions">
                        <button
                          className="sc-icon-btn"
                          title="リンクをコピー"
                          onClick={() => copyLink(e.page?.slug)}
                        >🔗</button>
                        <button
                          className="sc-icon-btn"
                          title="テキストで送る（本文をコピー）"
                          onClick={() => copyMessage(e)}
                        >📋</button>
                        <button
                          className="sc-icon-btn"
                          title="編集"
                          onClick={() => openEdit(e)}
                        >✏️</button>
                        <button
                          className="sc-icon-btn"
                          title="削除"
                          onClick={() => deletePage(e)}
                        >🗑️</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {toast && <div className="sc-toast show">{toast}</div>}
      {editing && (
        <div className="pp-busy-modal-overlay" onClick={() => setEditing(null)}>
          <div className="sc-edit-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="pp-busy-modal-close"
              aria-label="閉じる"
              onClick={() => setEditing(null)}
            >✕</button>
            <div className="pp-busy-modal-title">調整内容を編集</div>

            <div className="sc-field">
              <label>タイトル</label>
              <input className="sc-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="日程候補" />
            </div>

            <div className="sc-field">
              <label>打合せ時間</label>
              <select className="sc-select" value={editDuration} onChange={(e) => setEditDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d}分</option>)}
              </select>
            </div>

            <div className="sc-field">
              <label>営業時間（曜日ごと）</label>
              <div className="sc-weekly-hours">
                {DAY_KEYS.map((k) => {
                  const h = editHours[k];
                  return (
                    <div key={k} className="sc-weekly-hours-row">
                      <label className="sc-weekly-hours-day">
                        <input
                          type="checkbox"
                          checked={h.enabled}
                          onChange={(ev) => setEditHours((prev) => ({ ...prev, [k]: { ...prev[k], enabled: ev.target.checked } }))}
                        />
                        {DAY_LABELS[k]}
                      </label>
                      <input
                        className="sc-input"
                        type="time"
                        disabled={!h.enabled}
                        value={h.start}
                        onChange={(ev) => setEditHours((prev) => ({ ...prev, [k]: { ...prev[k], start: ev.target.value } }))}
                      />
                      <span className="sc-weekly-hours-sep">〜</span>
                      <input
                        className="sc-input"
                        type="time"
                        disabled={!h.enabled}
                        value={h.end}
                        onChange={(ev) => setEditHours((prev) => ({ ...prev, [k]: { ...prev[k], end: ev.target.value } }))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sc-field">
              <label>前後の確保時間（バッファ）</label>
              <div className="sc-row2">
                <select className="sc-select" value={editBufBefore} onChange={(e) => setEditBufBefore(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>前 {m}分</option>)}
                </select>
                <select className="sc-select" value={editBufAfter} onChange={(e) => setEditBufAfter(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>後 {m}分</option>)}
                </select>
              </div>
            </div>

            <div className="sc-field">
              <label>直前ブロック</label>
              <select className="sc-select" value={editMinNotice} onChange={(e) => setEditMinNotice(Number(e.target.value))}>
                <option value={0}>直前まで（無し）</option>
                <option value={30}>30分前まで</option>
                <option value={60}>60分前まで</option>
                <option value={120}>2時間前まで</option>
                <option value={240}>4時間前まで</option>
                <option value={1440}>24時間前まで</option>
              </select>
            </div>

            {editErr && <div className="sc-err" style={{ marginBottom: 10 }}>{editErr}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="sc-btn primary" disabled={editSaving} onClick={saveEdit}>
                {editSaving ? '保存中…' : '保存する'}
              </button>
              <button className="sc-btn ghost" onClick={() => setEditing(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
