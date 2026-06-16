/**
 * 共通コンポーネント `app/_shared/CopyLinkButton.tsx` と `app/_shared/QrCodeButton.tsx` の
 * 最小マウントテスト（3ケース）。
 *
 * - vitest は `environment: 'node'` のため、`react-dom/server` の `renderToString` で
 *   SSR レンダリングしてマークアップが期待文字列を含むことだけを検証する。
 * - 追加依存（jsdom/testing-library）なし。`useEffect` は SSR では発火しないので、
 *   path に依存する URL 表示の検証は行わず、ボタン基本表示と aria-label のみ確認する。
 * - JSX を避けるため React.createElement で組み立てる（.test.ts のまま動かす）。
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import CopyLinkButton from '../../app/_shared/CopyLinkButton';
import QrCodeButton from '../../app/_shared/QrCodeButton';

describe('app/_shared/CopyLinkButton', () => {
  it('既定ラベル「🔗 リンクをコピー」を描画し、共有用URLコピーの aria-label を持つ', () => {
    const html = renderToString(React.createElement(CopyLinkButton, { path: '/relay/foo' }));
    expect(html).toContain('🔗 リンクをコピー');
    expect(html).toContain('aria-label="共有用URLをコピー"');
    expect(html).toContain('type="button"');
  });

  it('label プロパティで表示テキストを差し替えできる', () => {
    const html = renderToString(
      React.createElement(CopyLinkButton, { path: '/b/bar', label: '🔗 URLをコピー' }),
    );
    expect(html).toContain('🔗 URLをコピー');
    expect(html).not.toContain('🔗 リンクをコピー');
  });
});

describe('app/_shared/QrCodeButton', () => {
  it('既定ラベル「📱 QRを表示」を描画し、モーダルは閉じた状態で初期化される', () => {
    const html = renderToString(React.createElement(QrCodeButton, { path: '/relay/baz' }));
    expect(html).toContain('📱 QRを表示');
    expect(html).toContain('aria-label="QRコードを表示"');
    // 初期は閉じているので role="dialog" は出ない
    expect(html).not.toContain('role="dialog"');
  });
});
