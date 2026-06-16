'use client';
/**
 * /admin/links 一覧テーブル。PATCH /api/admin/links/[slug] で有効/無効を切替。
 */
import { useEffect, useState } from 'react';

interface Row {
  slug: string;
  title: string;
  type: string;
  organizerId: string;
  isActive: boolean;
  createdAt: string;
  confirmationCount: number;
}

export default function LinksTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/links', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { links: Row[] };
      setRows(data.links);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(slug: string, next: 'active' | 'disabled') {
    setBusy(slug);
    try {
      const res = await fetch(`/api/admin/links/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p style={{ color: '#c00' }}>取得に失敗しました：{error}</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
      <thead>
        <tr style={{ background: '#f1f3f5', textAlign: 'left' }}>
          <Th>slug</Th>
          <Th>タイトル</Th>
          <Th>type</Th>
          <Th>状態</Th>
          <Th>作成日時</Th>
          <Th>予約数</Th>
          <Th>操作</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} style={{ padding: 16, color: '#57606a' }}>
              リンクがまだありません。
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.slug} style={{ borderTop: '1px solid #eaecef' }}>
            <Td>
              <code>{r.slug}</code>
            </Td>
            <Td>{r.title}</Td>
            <Td>{r.type}</Td>
            <Td>
              <Status active={r.isActive} />
            </Td>
            <Td>{formatJst(r.createdAt)}</Td>
            <Td>{r.confirmationCount}</Td>
            <Td>
              <button
                disabled={busy === r.slug}
                onClick={() => void toggle(r.slug, r.isActive ? 'disabled' : 'active')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #d0d7de',
                  background: r.isActive ? '#ffeaea' : '#e6ffec',
                  cursor: 'pointer',
                }}
              >
                {r.isActive ? '無効化' : '有効化'}
              </button>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '10px 12px', fontSize: 13, color: '#57606a' }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 12px', fontSize: 14 }}>{children}</td>;
}

function Status({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        background: active ? '#dafbe1' : '#ffebe9',
        color: active ? '#1a7f37' : '#cf222e',
      }}
    >
      {active ? 'アクティブ' : '無効'}
    </span>
  );
}

function formatJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
