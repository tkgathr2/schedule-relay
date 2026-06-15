'use client';
/**
 * /relay/[slug] — リレー型 候補一覧・予約画面。
 * 上に「A→B→C」のステップ可視化、下に各組合せ候補カード。
 * 候補ごとに「この組合せで仮押さえ」ボタン → /api/relay/[slug]/book。
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface CandidateStage {
  order: number;
  label: string;
  start: string;
  end: string;
}
interface Candidate {
  stages: CandidateStage[];
}
interface StageMeta {
  order: number;
  label: string;
  ownerEmail: string;
}
interface LinkInfo {
  title: string;
  durationMinutes: number;
  bufferMinutes: number;
  maxGapDays: number;
  stages: StageMeta[];
  status: string;
}

const TZ = 'Asia/Tokyo';

function fmt(iso: string): string {
  const d = new Date(iso);
  const dateFmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  const timeFmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateFmt.format(d)} ${timeFmt.format(d)}`;
}

export default function RelayDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<number | null>(null);
  const [bookedIdx, setBookedIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        setLoading(true);
        const [infoRes, candRes] = await Promise.all([
          fetch(`/api/relay/${slug}`),
          fetch(`/api/relay/${slug}/candidates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }),
        ]);
        const infoData = (await infoRes.json()) as
          | (LinkInfo & { stages?: unknown })
          | { error?: { message?: string } };
        const candData = (await candRes.json()) as
          | { candidates: Candidate[]; stages: StageMeta[] }
          | { error?: { message?: string } };
        if (cancelled) return;
        if (!infoRes.ok || !('title' in infoData)) {
          throw new Error(
            ('error' in infoData && infoData.error?.message) || 'リンク情報の取得に失敗しました',
          );
        }
        if (!candRes.ok || !('candidates' in candData)) {
          throw new Error(
            ('error' in candData && candData.error?.message) || '候補取得に失敗しました',
          );
        }
        // info.stages はサーバから {order,label,ownerEmail,calendarIds}[] の生JSON で来る。
        // candData.stages を権威にする（owner emailを含む整形済み）。
        const merged: LinkInfo = {
          title: infoData.title,
          durationMinutes: infoData.durationMinutes,
          bufferMinutes: infoData.bufferMinutes,
          maxGapDays: infoData.maxGapDays,
          status: infoData.status,
          stages: candData.stages,
        };
        setInfo(merged);
        setCandidates(candData.candidates);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const book = async (idx: number): Promise<void> => {
    if (!candidates) return;
    setError(null);
    setBooking(idx);
    try {
      const cand = candidates[idx]!;
      const res = await fetch(`/api/relay/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate: cand.stages.map((s) => ({ stage: s.order, start: s.start, end: s.end })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message ?? '仮押さえに失敗しました');
      }
      setBookedIdx(idx);
    } catch (err) {
      setError(err instanceof Error ? err.message : '仮押さえに失敗しました');
    } finally {
      setBooking(null);
    }
  };

  if (loading) {
    return (
      <main className="wrap" style={{ padding: 24 }}>
        <p>読み込み中…</p>
      </main>
    );
  }

  if (error && !info) {
    return (
      <main className="wrap" style={{ padding: 24 }}>
        <div style={{ background: '#fee', color: '#900', padding: 12, borderRadius: 6 }}>{error}</div>
      </main>
    );
  }

  if (!info) return null;

  return (
    <main className="wrap" style={{ padding: '24px 16px', maxWidth: 880 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>🔁 {info.title}</h1>
      <p style={{ color: '#555', fontSize: 13, marginBottom: 20 }}>
        所要時間 {info.durationMinutes}分 ／ バッファ {info.bufferMinutes}分 ／ 最大ギャップ{' '}
        {info.maxGapDays}日
      </p>

      {/* ステップ可視化 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 24,
          padding: 12,
          background: '#f0f7ff',
          borderRadius: 8,
        }}
      >
        {info.stages.map((s, i) => (
          <div key={s.order} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                background: '#06c',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
              }}
              title={s.ownerEmail}
            >
              {s.label}
            </div>
            {i < info.stages.length - 1 && <span style={{ color: '#06c', fontSize: 18 }}>→</span>}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fee', color: '#900', padding: 12, marginBottom: 16, borderRadius: 6 }}>
          {error}
        </div>
      )}

      {bookedIdx !== null && (
        <div
          style={{
            background: '#e8f5e9',
            color: '#1b5e20',
            padding: 14,
            marginBottom: 16,
            borderRadius: 6,
          }}
        >
          ✅ 仮押さえ完了：候補 #{bookedIdx + 1} の組合せで各ステージにホールドを作成しました。
        </div>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>
        候補（{candidates?.length ?? 0}件）
      </h2>

      {candidates && candidates.length === 0 && (
        <p style={{ color: '#888' }}>
          条件に合う候補が見つかりませんでした。期間・バッファ・最大ギャップを見直してください。
        </p>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {candidates?.map((c, idx) => {
          const disabled = bookedIdx !== null || booking !== null;
          const isBooked = bookedIdx === idx;
          return (
            <div
              key={idx}
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 14,
                background: isBooked ? '#f1f8e9' : '#fff',
              }}
            >
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>候補 #{idx + 1}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {c.stages.map((s, i) => (
                  <div key={s.order} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        padding: '6px 10px',
                        background: '#eaf3ff',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    >
                      <strong>{s.label}</strong> {fmt(s.start)}〜
                      {new Intl.DateTimeFormat('ja-JP', {
                        timeZone: TZ,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      }).format(new Date(s.end))}
                    </div>
                    {i < c.stages.length - 1 && <span style={{ color: '#888' }}>→</span>}
                  </div>
                ))}
              </div>
              <button
                onClick={() => book(idx)}
                disabled={disabled}
                style={{
                  padding: '8px 16px',
                  border: 0,
                  borderRadius: 4,
                  background: isBooked ? '#4caf50' : '#06c',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled && !isBooked ? 0.5 : 1,
                }}
              >
                {isBooked
                  ? '✓ 仮押さえ済み'
                  : booking === idx
                    ? '仮押さえ中…'
                    : 'この組合せで仮押さえ'}
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
}
