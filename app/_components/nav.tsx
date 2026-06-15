'use client';
/**
 * 共通ナビバー（Spir寄せの3画面構成）。
 * 全ページのトップに表示し、現在地タブを下線青で強調する。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; match: (p: string) => boolean };

const TABS: Tab[] = [
  { href: '/links', label: '空き時間リンク', match: (p) => p === '/' || p.startsWith('/links') },
  { href: '/calendar', label: 'カレンダー', match: (p) => p.startsWith('/calendar') },
  { href: '/unconfirmed', label: '未確定の調整', match: (p) => p.startsWith('/unconfirmed') },
  { href: '/confirmed', label: '確定済の予定', match: (p) => p.startsWith('/confirmed') },
];

export default function Nav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="nav">
      <div className="wrap navin">
        <Link href="/" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="mark">📅</span>スケジュール調整くん
        </Link>
        <div className="navtabs">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`navtab${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <div className="navright">
          <span className="sync"><span className="dot-live" />Googleカレンダー同期中</span>
        </div>
      </div>
    </nav>
  );
}
