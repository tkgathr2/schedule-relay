/**
 * /admin レイアウト。シンプルなナビと内側コンテナだけ。
 * 認証は middleware で済ませる前提。
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', color: '#222' }}>
      <header
        style={{
          background: '#0b3d91',
          color: '#fff',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <strong style={{ fontSize: 18 }}>スケ調くん 管理</strong>
        <nav style={{ display: 'flex', gap: 16, fontSize: 14 }}>
          <Link href="/admin" style={{ color: '#fff', textDecoration: 'none' }}>
            ダッシュボード
          </Link>
          <Link href="/admin/links" style={{ color: '#fff', textDecoration: 'none' }}>
            リンク
          </Link>
          <Link href="/admin/relay" style={{ color: '#fff', textDecoration: 'none' }}>
            リレー
          </Link>
        </nav>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>{children}</main>
    </div>
  );
}
