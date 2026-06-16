/**
 * vitest 設定。tsconfig の `@/* -> src/*` エイリアスを vitest にも反映し、
 * app/api ルートからの `@/service/...` import を解決できるようにする。
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${path.resolve(__dirname, 'src')}/`,
    },
  },
  test: {
    environment: 'node',
  },
});
