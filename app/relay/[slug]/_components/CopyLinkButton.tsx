'use client';
/**
 * 共有用URLコピーボタン。クリックで `${origin}/relay/${slug}` を
 * navigator.clipboard.writeText し、1.5秒「コピーしました」を表示する。
 */
import React, { useEffect, useState } from 'react';

interface Props {
  slug: string;
}

export default function CopyLinkButton({ slug }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/relay/${slug}`);
    }
  }, [slug]);

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
      {copied ? '✓ コピーしました' : '🔗 リンクをコピー'}
    </button>
  );
}
