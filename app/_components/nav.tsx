'use client';
/**
 * 共通ナビバー（Spir寄せの3画面構成）。
 * 全ページのトップに表示し、現在地タブを下線青で強調する。
 *
 * モバイル（≤768px）ではハンバーガーメニュー化し、タップでオーバーレイ展開する。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

type Tab = { href: string; label: string; match: (p: string) => boolean };

const TABS: Tab[] = [
  { href: '/links', label: '空き時間リンク', match: (p) => p === '/' || p.startsWith('/links') },
  { href: '/propose', label: 'カレンダー', match: (p) => p.startsWith('/propose') || p.startsWith('/calendar') },
  { href: '/relay/new', label: 'リレー新規', match: (p) => p.startsWith('/relay') },
  { href: '/unconfirmed', label: '未確定の調整', match: (p) => p.startsWith('/unconfirmed') },
  { href: '/confirmed', label: '確定済の予定', match: (p) => p.startsWith('/confirmed') },
];

export default function Nav() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);

  // パス変更時にメニュー自動クローズ
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // メニュー開時は body スクロール抑止（モバイルのみ）
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <nav className="nav">
      <div className="wrap navin">
        <Link href="/" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="mark">📅</span>スケ調くん
        </Link>
        <div className="navtabs navtabs-desktop">
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
        <div className="navright navright-desktop">
          <span className="sync"><span className="dot-live" />Googleカレンダー同期中</span>
        </div>
        <button
          type="button"
          className="nav-burger"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '✕' : '☰'}
        </button>
      </div>
      {open && (
        <div className="nav-overlay" onClick={() => setOpen(false)}>
          <div className="nav-overlay-inner" onClick={(e) => e.stopPropagation()}>
            {TABS.map((t) => {
              const active = t.match(pathname);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`nav-overlay-tab${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {t.label}
                </Link>
              );
            })}
            <div className="nav-overlay-sync">
              <span className="sync"><span className="dot-live" />Googleカレンダー同期中</span>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
