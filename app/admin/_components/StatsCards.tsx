'use client';
/**
 * /admin トップのサマリカード（4枚）。クライアント側で /api/admin/stats を fetch。
 */
import { useEffect, useState } from 'react';

interface Stats {
  link: { total: number; active: number; confirmations: number };
  relay: { total: number; active: number; holds: number };
  confirmationsLast24h: number;
}

export default function StatsCards() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/stats', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Stats;
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ color: '#c00' }}>取得に失敗しました：{error}</p>;
  if (!stats) return <p>読み込み中…</p>;

  const cards = [
    {
      label: 'リンク（公開ページ）',
      lines: [
        ['総数', stats.link.total],
        ['アクティブ', stats.link.active],
        ['累計予約数', stats.link.confirmations],
      ],
    },
    {
      label: 'リレーリンク',
      lines: [
        ['総数', stats.relay.total],
        ['アクティブ', stats.relay.active],
        ['累計仮押さえ数', stats.relay.holds],
      ],
    },
    {
      label: '直近 24 時間の予約',
      lines: [['予約数', stats.confirmationsLast24h]],
    },
    {
      label: '稼働状況',
      lines: [
        ['Link 稼働率', `${pct(stats.link.active, stats.link.total)}%`],
        ['Relay 稼働率', `${pct(stats.relay.active, stats.relay.total)}%`],
      ],
    },
  ] as const;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: '#fff',
            border: '1px solid #d0d7de',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, color: '#57606a', marginBottom: 8 }}>{c.label}</div>
          {c.lines.map(([k, v]) => (
            <div
              key={k}
              style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}
            >
              <span style={{ color: '#57606a' }}>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}
