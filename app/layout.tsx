import type { Metadata } from 'next';
import Nav from './_components/nav';
import './globals.css';
import './scheduler.css';

export const metadata: Metadata = {
  title: 'スケジュール調整くん｜Spir全機能 ＋ リレー型調整',
  description:
    'Google/Microsoftカレンダー連携の日程調整ツール。空き時間リンク・確定・投票・チーム調整に加え、A→B→Cと順番に決める「リレー型」調整ができる唯一のツール。',
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
