'use client';
/**
 * relay 画面向け薄いラッパー。共通実装 `app/_shared/CopyLinkButton.tsx` に
 * `path={`/relay/${slug}`}` を渡すだけ。既存の relay/page.tsx の import は変えない。
 */
import React from 'react';
import SharedCopyLinkButton from '../../../_shared/CopyLinkButton';

interface Props {
  slug: string;
}

export default function CopyLinkButton({ slug }: Props): React.JSX.Element {
  return <SharedCopyLinkButton path={`/relay/${slug}`} />;
}
