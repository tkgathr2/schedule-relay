'use client';
/**
 * /admin/stats — 詳細統計画面。
 *  - 過去30日：予約確定 / リレー仮押さえ の日別折れ線（同一SVG）
 *  - 過去7日：APIリクエスト数（簡易：Confirmation/RelayLinkHold createdAt 集計を再利用）
 *  - 上位リンク TOP10（予約数ランキング）
 *  - アクティブ vs 無効 円グラフ（簡易SVG）
 * 認証は middleware で済ませる前提。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import TimeSeriesChart, {
  type ChartSeries,
  type ChartPoint,
} from '../_components/TimeSeriesChart';

interface TimeseriesResp {
  days: number;
  from: string;
  to: string;
  confirmations: { date: string; count: number }[];
  holds: { date: string; count: number }[];
}

interface LinksResp {
  links: {
    slug: string;
    title: string;
    isActive: boolean;
    confirmationCount: number;
  }[];
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

export default function AdminStatsPage() {
  const [ts30, setTs30] = useState<TimeseriesResp | null>(null);
  const [ts7, setTs7] = useState<TimeseriesResp | null>(null);
  const [links, setLinks] = useState<LinksResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r30, r7, rL] = await Promise.all([
          fetch('/api/admin/stats/timeseries?days=30', { cache: 'no-store' }),
          fetch('/api/admin/stats/timeseries?days=7', { cache: 'no-store' }),
          fetch('/api/admin/links', { cache: 'no-store' }),
        ]);
        if (!r30.ok) throw new Error(`timeseries30 HTTP ${r30.status}`);
        if (!r7.ok) throw new Error(`timeseries7 HTTP ${r7.status}`);
        if (!rL.ok) throw new Error(`links HTTP ${rL.status}`);
        const j30 = (await r30.json()) as TimeseriesResp;
        const j7 = (await r7.json()) as TimeseriesResp;
        const jL = (await rL.json()) as LinksResp;
        if (cancelled) return;
        setTs30(j30);
        setTs7(j7);
        setLinks(jL);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section>
        <PageHead />
        <p style={{ color: '#c00' }}>取得に失敗しました：{error}</p>
      </section>
    );
  }
  if (!ts30 || !ts7 || !links) {
    return (
      <section>
        <PageHead />
        <p>読み込み中…</p>
      </section>
    );
  }

  const series30: ChartSeries[] = [
    {
      name: '予約確定数',
      color: '#0b3d91',
      points: ts30.confirmations.map<ChartPoint>((p) => ({ date: p.date, value: p.count })),
    },
    {
      name: 'リレー仮押さえ数',
      color: '#d97706',
      points: ts30.holds.map<ChartPoint>((p) => ({ date: p.date, value: p.count })),
    },
  ];

  // 簡易：APIリクエスト数 ≒ confirmations + holds の合算（loggerは別途 / DB履歴だけで近似）。
  const apiSeries: ChartSeries[] = [
    {
      name: 'APIリクエスト数（推定）',
      color: '#059669',
      points: ts7.confirmations.map<ChartPoint>((p, i) => ({
        date: p.date,
        value: p.count + (ts7.holds[i]?.count ?? 0),
      })),
    },
  ];

  // 上位リンク TOP10
  const top = [...links.links]
    .sort((a, b) => b.confirmationCount - a.confirmationCount)
    .slice(0, 10);

  // アクティブ vs 無効
  const activeCount = links.links.filter((l) => l.isActive).length;
  const inactiveCount = links.links.length - activeCount;

  return (
    <section>
      <PageHead />

      <div style={CARD}>
        <h2 style={H2}>過去30日：予約確定 / リレー仮押さえ</h2>
        <TimeSeriesChart series={series30} />
      </div>

      <div style={CARD}>
        <h2 style={H2}>過去7日：APIリクエスト数（推定）</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
          注：簡易推定（Confirmation + RelayLinkHold の作成数合算）。詳細ロガー集計は今後追加予定。
        </p>
        <TimeSeriesChart series={apiSeries} />
      </div>

      <div style={CARD}>
        <h2 style={H2}>上位リンク TOP10（予約数ランキング）</h2>
        {top.length === 0 ? (
          <p style={{ color: '#6b7280' }}>データがありません。</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={TH}>順位</th>
                <th style={TH}>タイトル</th>
                <th style={TH}>slug</th>
                <th style={TH}>状態</th>
                <th style={{ ...TH, textAlign: 'right' }}>予約数</th>
              </tr>
            </thead>
            <tbody>
              {top.map((l, i) => (
                <tr key={l.slug}>
                  <td style={TD}>{i + 1}</td>
                  <td style={TD}>{l.title}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{l.slug}</td>
                  <td style={TD}>
                    {l.isActive ? (
                      <span style={{ color: '#059669' }}>● アクティブ</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>○ 無効</span>
                    )}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>
                    {l.confirmationCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={CARD}>
        <h2 style={H2}>アクティブ vs 無効（リンク）</h2>
        <PieChart active={activeCount} inactive={inactiveCount} />
      </div>
    </section>
  );
}

function PageHead() {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>📈 詳細統計</h1>
      <p style={{ margin: 0, fontSize: 13 }}>
        <Link href="/admin">← ダッシュボードへ戻る</Link>
      </p>
    </div>
  );
}

const H2: React.CSSProperties = { fontSize: 16, margin: '0 0 8px' };
const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid #d0d7de',
  fontWeight: 600,
};
const TD: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef0f3' };

function PieChart({ active, inactive }: { active: number; inactive: number }) {
  const total = active + inactive;
  if (total === 0) {
    return <p style={{ color: '#6b7280' }}>リンクがありません。</p>;
  }
  const r = 70;
  const cx = 90;
  const cy = 90;
  const ratio = active / total;
  // 100% / 0% の縮退は完全な円1枚で描画（弧パスは1点ループだと描画されないため）。
  const fullActive = ratio >= 1;
  const fullInactive = ratio <= 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg viewBox="0 0 180 180" width={180} height={180} role="img" aria-label="アクティブ vs 無効">
        {fullActive ? (
          <circle cx={cx} cy={cy} r={r} fill="#059669" />
        ) : fullInactive ? (
          <circle cx={cx} cy={cy} r={r} fill="#9ca3af" />
        ) : (
          <>
            {arc(cx, cy, r, 0, ratio, '#059669')}
            {arc(cx, cy, r, ratio, 1, '#9ca3af')}
          </>
        )}
      </svg>
      <div style={{ fontSize: 14 }}>
        <div>
          <span style={LEGEND_SQ('#059669')} /> アクティブ：{active}（
          {((active / total) * 100).toFixed(1)}%）
        </div>
        <div>
          <span style={LEGEND_SQ('#9ca3af')} /> 無効：{inactive}（
          {((inactive / total) * 100).toFixed(1)}%）
        </div>
        <div style={{ color: '#6b7280', marginTop: 4 }}>合計：{total}</div>
      </div>
    </div>
  );
}

const LEGEND_SQ = (c: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 10,
  height: 10,
  background: c,
  marginRight: 6,
  borderRadius: 2,
});

/** 円弧パス（start/end は 0〜1 の比率）。 */
function arc(cx: number, cy: number, r: number, start: number, end: number, fill: string) {
  const a0 = start * 2 * Math.PI - Math.PI / 2;
  const a1 = end * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = end - start > 0.5 ? 1 : 0;
  const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  return <path d={d} fill={fill} />;
}
