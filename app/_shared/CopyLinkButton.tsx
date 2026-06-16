'use client';
/**
 * 共通 URLコピーボタン。`path`（"/relay/foo" や "/b/bar" のような絶対パス）を受け取り、
 * navigator.clipboard.writeText で `${origin}${path}` をコピーする。
 * relay/[slug] と b/[slug] の両画面で再利用するため app/_shared に切り出した。
 */
import React, { useEffect, useState } from 'react';

interface Props {
  /** コピー対象の絶対パス（例: "/relay/foo", "/b/bar"）。先頭にスラッシュを含めること。 */
  path: string;
  /** ボタン表示テキスト（任意・既定 "🔗 リンクをコピー"） */
  label?: string;
}

export default function CopyLinkButton({ path, label }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}${path}`);
    }
  }, [path]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onClick = async (): Promise<void> => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // クリップボード不可な環境（http等）：何もしないでフォールバック表示
      setCopied(false);
    }
  };

  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        padding: '6px 12px',
        border: '1px solid #06c',
        borderRadius: 4,
        background: copied ? '#e8f5e9' : '#fff',
        color: copied ? '#1b5e20' : '#06c',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
      aria-label="共有用URLをコピー"
    >
      {copied ? '✓ コピーしました' : (label ?? '🔗 リンクをコピー')}
    </button>
  );
}
