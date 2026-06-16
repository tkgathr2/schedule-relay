'use client';
/**
 * relay 画面向け薄いラッパー。共通実装 `app/_shared/QrCodeButton.tsx` に
 * `path={`/relay/${slug}`}` を渡すだけ。既存の relay/page.tsx の import は変えない。
 */
import React from 'react';
import SharedQrCodeButton from '../../../_shared/QrCodeButton';

interface Props {
  slug: string;
}

export default function QrCodeButton({ slug }: Props): React.JSX.Element {
  return <SharedQrCodeButton path={`/relay/${slug}`} />;
}
