import type { MetadataRoute } from 'next';

/**
 * Next.js 15 metadata API による PWA Web App Manifest。
 * `/manifest.webmanifest` で配信される。
 *
 * 配置すると、スマホで「ホーム画面に追加」した時にスタンドアロン起動となり、
 * Spir同等のアプリ感（タブバー無し・テーマ色のステータスバー）になる。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'スケジュール調整くん',
    short_name: '調整くん',
    description:
      'Google/Microsoftカレンダー連携の日程調整ツール。空き時間リンク・リレー型調整に対応。',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#1e88e5',
    background_color: '#ffffff',
    lang: 'ja',
    scope: '/',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
