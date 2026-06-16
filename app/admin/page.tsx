/**
 * /admin トップ — サマリカード。
 */
import Link from 'next/link';
import StatsCards from './_components/StatsCards';

export const dynamic = 'force-dynamic';

export default function AdminTopPage() {
  return (
    <section>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>管理ダッシュボード</h1>
      <StatsCards />
      <p style={{ marginTop: 16 }}>
        <Link
          href="/admin/stats"
          style={{
            display: 'inline-block',
            padding: '8px 14px',
            background: '#0b3d91',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          📈 詳細統計（時系列グラフ・TOP10・円グラフ）
        </Link>
      </p>
    </section>
  );
}
