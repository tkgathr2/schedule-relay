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

function fmtDuration(min?: number): string {
  if (!min) return '未設定';
  return `${min}分`;
}

export default function UnconfirmedPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/events?status=open|holding');
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as { events: EventRow[] };
      setEvents(j.events);
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
                  const title = e.page?.settings?.title || '(無題)';
                  const dur = fmtDuration(e.page?.settings?.duration_minutes);
                  const participants = e.page?.settings?.participants?.join('・') || '—';
                  return (
                    <tr key={e.id}>
                      <td>{dur}</td>
                      <td className="cell-title">
                        {title}
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280' }}>[{e.status}]</span>
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
