import type { Metadata, Viewport } from 'next';
import Nav from './_components/nav';
import './globals.css';
import './scheduler.css';

export const metadata: Metadata = {
  title: 'スケ調くん｜Spir全機能 ＋ リレー型調整',
  description:
    'Google/Microsoftカレンダー連携の日程調整ツール。空き時間リンク・確定・チーム調整に加え、A→B→Cと順番に決める「リレー型」調整ができる唯一のツール。',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '調整くん',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1e88e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
