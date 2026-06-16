/**
 * /admin トップ — サマリカード。
 */
import StatsCards from './_components/StatsCards';

export const dynamic = 'force-dynamic';

export default function AdminTopPage() {
  return (
    <section>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>管理ダッシュボード</h1>
      <StatsCards />
    </section>
  );
}
