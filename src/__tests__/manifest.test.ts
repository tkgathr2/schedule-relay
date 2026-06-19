/**
 * PWA Web App Manifest（app/manifest.ts）の出力検証。
 * Next.js 15 の MetadataRoute.Manifest 型に準拠した JSON が返ることを確認する。
 */
import { describe, it, expect } from 'vitest';
// `app/manifest.ts` は ESM。tsconfig の `paths` には載っていないので相対参照する。
// （Vitest は extensionAlias を解釈しないため、.ts そのまま import する）
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — next の型は dev で解決される。テストはランタイム JSON のみ検証。
import manifest from '../../app/manifest.js';

describe('PWA manifest', () => {
  it('基本フィールド（name/short_name/start_url/display）が揃っている', () => {
    const m = manifest();
    expect(m.name).toBe('スケ調くん');
    expect(m.short_name).toBe('調整くん');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('カラー設定がブランド色（#1e88e5 系）になっている', () => {
    const m = manifest();
    expect(m.theme_color).toBe('#1e88e5');
    expect(m.background_color).toBe('#ffffff');
    expect(m.lang).toBe('ja');
  });

  it('192/512 PNG アイコンが含まれ、maskable も用意されている', () => {
    const m = manifest();
    expect(Array.isArray(m.icons)).toBe(true);
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    // すべて PNG
    for (const i of icons) {
      expect(i.type).toBe('image/png');
      expect(i.src.startsWith('/icons/')).toBe(true);
    }
    // maskable purpose が少なくとも1つ存在
    const hasMaskable = icons.some((i) => (i.purpose ?? '').includes('maskable'));
    expect(hasMaskable).toBe(true);
  });
});
