'use client';
/**
 * 仮押さえ済み一覧。`GET /api/relay/[slug]/holds` の結果を描画する。
 * 各行：ステージごとの日時範囲＋作成日時。空のときは案内文。
 */
import React, { useEffect, useState } from 'react';

interface HoldDto {
  id: string;
  stageOrder: number;
  stageLabel: string;
  ownerEmail: string;
  start: string;
  end: string;
  status: string;
  createdAt: string;
}

const TZ = 'Asia/Tokyo';

function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const dFmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  const tFmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dFmt.format(s)} ${tFmt.format(s)}〜${tFmt.format(e)}`;
}

function fmtCreated(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

interface Props {
  slug: string;
  /** 親で book に成功したタイミングで増えるカウンタ。変わったら再fetchする。 */
  refreshKey?: number;
}

export default function HoldsList({ slug, refreshKey }: Props): React.JSX.Element {
  const [holds, setHolds] = useState<HoldDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        setLoading(true);
        const res = await fetch(`/api/relay/${slug}/holds`, { cache: 'no-store' });
        const data = (await res.json()) as
          | { holds: HoldDto[] }
          | { error?: { message?: string } };
        if (cancelled) return;
        if (!res.ok || !('holds' in data)) {
          throw new Error(
            ('error' in data && data.error?.message) || '仮押さえ一覧の取得に失敗しました',
          );
        }
        setHolds(data.holds);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, refreshKey]);

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>仮押さえ済み</h2>
      {loading && <p style={{ color: '#888', fontSize: 13 }}>読み込み中…</p>}
      {error && (
        <div style={{ background: '#fee', color: '#900', padding: 12, borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !error && holds && holds.length === 0 && (
        <p style={{ color: '#888', fontSize: 13 }}>まだ仮押さえはありません</p>
      )}
      {!loading && !error && holds && holds.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {holds.map((h) => (
            <li
              key={h.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '10px 12px',
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: '#06c',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {h.stageLabel}
                </span>
                <span style={{ fontSize: 13 }}>{fmtRange(h.start, h.end)}</span>
              </div>
              <span style={{ fontSize: 11, color: '#888' }}>作成 {fmtCreated(h.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
