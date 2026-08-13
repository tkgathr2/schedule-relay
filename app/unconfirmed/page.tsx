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
  // 複数選択して一括削除するための選択状態（社長要望：1件ずつ🗑️を押さず選んでまとめて消したい）。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
    setSelected(new Set());
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

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!events) return;
    setSelected((prev) => (prev.size === events.length ? new Set() : new Set(events.map((e) => e.id))));
  };

  // 選択した複数件をまとめて削除する（社長要望：1件ずつ🗑️を押さず選んでまとめて消したい）。
  const deleteSelected = async () => {
    if (!events || selected.size === 0) return;
    const rows = events.filter((e) => selected.has(e.id));
    if (!confirm(`選択した${rows.length}件を削除しますか？\n相手が持っているリンクも無効になります。`)) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.all(
        rows.map(async (row) => {
          const slug = row.page?.slug;
          if (!slug) return false;
          try {
            const res = await fetch(`/api/pages/${slug}/cancel`, { method: 'POST' });
            return res.ok;
          } catch {
            return false;
          }
        }),
      );
      const failCount = results.filter((ok) => !ok).length;
      setToast(failCount === 0 ? `${rows.length}件を削除しました` : `${rows.length - failCount}件削除・${failCount}件失敗`);
      setTimeout(() => setToast(null), 1500);
      setSelected(new Set());
      void load();
    } finally {
      setBulkDeleting(false);
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

  return (
    <main className="sc-list-page">
      <div className="wrap">
        <div className="sc-list-head">
          <div>
            <h1>未確定の調整</h1>
            <div className="sub">相手の返事待ち、または仮押さえ中の調整一覧です。</div>
          </div>
          {selected.size > 0 && (
            <button
              className="sc-btn"
              style={{ background: '#dc2626', color: '#fff' }}
              disabled={bulkDeleting}
              onClick={deleteSelected}
            >
              {bulkDeleting ? '削除中…' : `選択した${selected.size}件を削除`}
            </button>
          )}
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
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={events.length > 0 && selected.size === events.length}
                      onChange={toggleSelectAll}
                      aria-label="すべて選択"
                    />
                  </th>
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
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                          aria-label={`${title}を選択`}
                        />
                      </td>
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
                        <a
                          className="sc-icon-btn"
                          title="編集"
                          href={e.page?.slug ? `/propose?edit=${e.page.slug}` : undefined}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                        >✏️</a>
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
    </main>
  );
}
