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
};

export default nextConfig;
