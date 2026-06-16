'use client';
/**
 * 共通 QRコード表示ボタン＋モーダル。`path`（絶対パス）を受け取り、
 * `${origin}${path}` を SVG QR で描画する。
 * relay/[slug] と b/[slug] の両画面で再利用するため app/_shared に切り出した。
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  /** QR化する絶対パス（例: "/relay/foo", "/b/bar"）。先頭にスラッシュを含めること。 */
  path: string;
  /** ボタン表示テキスト（任意・既定 "📱 QRを表示"） */
  label?: string;
}

export default function QrCodeButton({ path, label }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string>('');
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}${path}`);
    }
  }, [path]);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const s = await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 });
        if (!cancelled) setSvg(s);
      } catch {
        if (!cancelled) setSvg('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 12px',
          border: '1px solid #06c',
          borderRadius: 4,
          background: '#fff',
          color: '#06c',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
        aria-label="QRコードを表示"
      >
        {label ?? '📱 QRを表示'}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="QRコード"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 10,
              maxWidth: 320,
              width: '90%',
              textAlign: 'center',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: 16 }}>このリンクのQRコード</h3>
            <div
              style={{ margin: '12px 0', display: 'flex', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: svg || '<p>生成中…</p>' }}
            />
            <p style={{ fontSize: 11, color: '#666', wordBreak: 'break-all', margin: '8px 0 16px' }}>{url}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '8px 16px',
                border: 0,
                borderRadius: 4,
                background: '#06c',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
