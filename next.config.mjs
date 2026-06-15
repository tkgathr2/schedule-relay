/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ドメイン層は ESM 流儀で `./x.js` と書く（NodeNext/vitest 互換）。
  // webpack(Next) が `.js` を `.ts` 解決できるよう extensionAlias を付与する。
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  // Turbopack 用にも同等の解決を設定（next dev --turbo / 将来の既定化に備える）。
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  // PWA / モバイル向けレスポンスヘッダ。manifest と icons は長期キャッシュ。
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
