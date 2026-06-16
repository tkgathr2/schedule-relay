/**
 * /admin/links — Link（BookingPage）一覧。
 */
import LinksTable from '../_components/LinksTable';

export const dynamic = 'force-dynamic';

export default function AdminLinksPage() {
  return (
    <section>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>リンク一覧</h1>
      <LinksTable />
    </section>
  );
}
