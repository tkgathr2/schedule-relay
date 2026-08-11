'use client';
/**
 * /unconfirmed — 未確定の調整一覧（Spir同等）。
 * GET /api/events?status=open|holding をデータ源にテーブル表示。
 */
import { useCallback, useEffect, useState } from 'react';

type PageMeta = {
  id: string;
  slug: string;
  organizerId: string;
  settings: { title?: string; duration_minutes?: number; participants?: string[] } | null;
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
  settings: { title?: string; duration_minutes?: number; participants?: string[] } | null;
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

export default function UnconfirmedPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

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
                        <button className="sc-icon-btn" title="カレンダー">📅</button>
                        <div className="sc-menu-wrap" style={{ display: 'inline-block' }}>
                          <button
                            className="sc-icon-btn"
                            onClick={() => setMenuOpen(menuOpen === e.id ? null : e.id)}
                          >⋯</button>
                          {menuOpen === e.id && (
                            <div className="sc-menu" onMouseLeave={() => setMenuOpen(null)}>
                              <button className="danger" onClick={() => alert('キャンセル機能は別途実装')}>キャンセル</button>
                            </div>
                          )}
                        </div>
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
