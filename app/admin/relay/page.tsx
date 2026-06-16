/**
 * /admin/relay — RelayLink 一覧。
 */
import RelayTable from '../_components/RelayTable';

export const dynamic = 'force-dynamic';

export default function AdminRelayPage() {
  return (
    <section>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>リレーリンク一覧</h1>
      <RelayTable />
    </section>
  );
}
