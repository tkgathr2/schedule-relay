'use client';
/**
 * 共通 .ics ダウンロードボタン。`url` と `filename` を受け取り、
 * <a href download> で iCalendar をダウンロードさせる。
 * relay/[slug] と b/[slug] の両画面で再利用するため app/_shared に切り出した。
 */
import React from 'react';

interface Props {
  /** .ics の取得URL（例: "/api/b/<slug>/ical", "/api/relay/<slug>/ical"） */
  url: string;
  /** ダウンロード時のファイル名（例: "<slug>.ics"） */
  filename: string;
  /** ボタン表示テキスト（任意・既定 "📅 .ics ダウンロード"） */
  label?: string;
}

export default function IcalButton({ url, filename, label }: Props): React.JSX.Element {
  return (
    <a
      href={url}
      download={filename}
      style={{
        display: 'inline-block',
        padding: '6px 12px',
        border: '1px solid #06c',
        borderRadius: 4,
        background: '#fff',
        color: '#06c',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        textDecoration: 'none',
      }}
      aria-label="iCalendar (.ics) をダウンロード"
    >
      {label ?? '📅 .ics ダウンロード'}
    </a>
  );
}
