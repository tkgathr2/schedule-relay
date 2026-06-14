'use client';
/**
 * ランディング下に出す「あなたが最近作ったページ」（localStorage版）。
 * Auth.js 無しでも、自分が作ったURLを毎回コピペで管理しなくて済むようにする。
 */
import { useEffect, useState } from 'react';

type MyPage = { slug: string; title: string; durationMin: number; createdAt: string };

export default function MyPages() {
  const [pages, setPages] = useState<MyPage[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('schedule-relay:my-pages');
      const list = raw ? (JSON.parse(raw) as MyPage[]) : [];
      setPages(Array.isArray(list) ? list : []);
    } catch {
      setPages([]);
    }
  }, []);

  if (pages === null) return null; // SSR/初期描画ちらつき防止

  const copy = async (slug: string) => {
    const url = `${window.location.origin}/b/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(slug);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* noop */ }
  };

  return (
    <section className="section">
      <div className="wrap">
        <h2 style={{ margin: '0 0 12px' }}>あなたが最近作ったページ</h2>
        <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 13 }}>
          このブラウザで作成した予約ページの履歴です（端末に保存）。
        </p>
        {pages.length === 0 ? (
          <div style={{ padding: 24, border: '1px dashed #e5e7eb', borderRadius: 10, color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
            まだ作っていません。「＋ 空き時間リンクを作る」から最初の1本を作れます。
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {pages.map((p) => {
              const url = typeof window !== 'undefined' ? `${window.location.origin}/b/${p.slug}` : `/b/${p.slug}`;
              return (
                <li key={p.slug} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: '#fff' }}>
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || '(無題)'}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {p.durationMin}分 ・ <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>/b/{p.slug}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => copy(p.slug)}
                      style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
                    >
                      {copied === p.slug ? '✓ コピー済み' : 'URLをコピー'}
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ background: '#2563eb', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600 }}
                    >
                      予約ページを開く
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
