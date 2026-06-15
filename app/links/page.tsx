'use client';
/**
 * /links — 空き時間リンク一覧画面（Spir同等）。
 * GET /api/pages?organizerId=takagi をデータ源にテーブル表示。
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type PageRow = {
  id: string;
  organizerId: string;
  type: string;
  slug: string;
  isActive: boolean;
  settings: { title?: string; duration_minutes?: number } | null;
  createdAt: number;
};

const ORGANIZER_ID = 'takagi';

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const H = String(d.getHours()).padStart(2, '0');
  const M = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${mo}/${da} ${H}:${M}`;
}

export default function LinksPage() {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/pages?organizerId=${ORGANIZER_ID}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as { pages: PageRow[] };
      // 二重防御：化け文字（U+FFFD = ）を含むタイトルはDB側のレガシー破損データ
      // なので一覧に出さない（API側 isActive=true フィルタとは別の保険）
      const clean = (j.pages || []).filter((p) => {
        const t = (p.settings as { title?: unknown } | null | undefined)?.title;
        if (typeof t !== 'string') return true;
        return !t.includes('�');
      });
      setPages(clean);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '読み込みに失敗しました');
      setPages([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (slug: string) => {
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

  const cancel = async (slug: string) => {
    if (!confirm(`「${slug}」を非アクティブにしますか？`)) return;
    try {
      const r = await fetch(`/api/pages/${slug}/cancel`, { method: 'POST' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      setToast('非アクティブにしました');
      setTimeout(() => setToast(null), 1500);
      void load();
    } catch {
      setToast('失敗しました');
      setTimeout(() => setToast(null), 1500);
    }
    setMenuOpen(null);
  };

  return (
    <main className="sc-list-page">
      <div className="wrap">
        <div className="sc-list-head">
          <div>
            <h1>空き時間リンク</h1>
            <div className="sub">URL を送るだけで相手が1枠選んで予約できる、繰り返し使える調整リンクの一覧です。</div>
          </div>
          <Link href="/create" className="sc-btn-primary">+ 空き時間リンクを作成</Link>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            読み込みエラー：{err}
          </div>
        )}

        {pages === null ? (
          <div className="sc-list-card"><div className="sc-list-empty">読み込み中…</div></div>
        ) : pages.length === 0 ? (
          <div className="sc-list-card">
            <div className="sc-list-empty">
              <h3>まだ空き時間リンクがありません</h3>
              <p>「空き時間リンク」は、あなたの空き枠をURLで共有する繰り返し使えるページです。<br/>面談・打合せ・1on1 など、定期的に予約を受けたい時に使えます。</p>
              <Link href="/create" className="sc-btn-primary">+ 最初の1本を作成</Link>
            </div>
          </div>
        ) : (
          <div className="sc-list-card">
            <table className="sc-list-table">
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>slug</th>
                  <th>公開URL</th>
                  <th>作成日時</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const title = p.settings?.title || '(無題)';
                  const url = typeof window !== 'undefined' ? `${window.location.origin}/b/${p.slug}` : `/b/${p.slug}`;
                  return (
                    <tr key={p.id}>
                      <td className="cell-title">
                        {title}
                        {!p.isActive && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: 4 }}>
                            非アクティブ
                          </span>
                        )}
                      </td>
                      <td><code>{p.slug}</code></td>
                      <td>
                        <button className="sc-btn-ghost" onClick={() => copy(p.slug)}>
                          URLをコピー
                        </button>
                      </td>
                      <td className="cell-muted">{fmtDate(p.createdAt)}</td>
                      <td className="cell-actions">
                        <div className="sc-menu-wrap">
                          <button
                            className="sc-icon-btn"
                            aria-label="メニュー"
                            onClick={() => setMenuOpen(menuOpen === p.slug ? null : p.slug)}
                          >…</button>
                          {menuOpen === p.slug && (
                            <div className="sc-menu" onMouseLeave={() => setMenuOpen(null)}>
                              <a href={url} target="_blank" rel="noreferrer">
                                <button>開く</button>
                              </a>
                              <button className="danger" onClick={() => cancel(p.slug)}>非アクティブにする</button>
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
