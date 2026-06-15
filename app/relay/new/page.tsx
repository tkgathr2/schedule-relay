'use client';
/**
 * /relay/new — リレー型 T6 リンク新規作成。
 * 採用面接など「A→B→C」と順番に通る調整リンクを発行する。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StageForm {
  label: string;
  ownerEmail: string;
  calendarIds: string;
}

const DEFAULT_STAGE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function emptyStage(i: number): StageForm {
  return { label: DEFAULT_STAGE_LABELS[i] ?? `S${i + 1}`, ownerEmail: '', calendarIds: 'primary' };
}

export default function RelayNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState('採用面接（A→B→C）');
  const [duration, setDuration] = useState(60);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [maxGapDays, setMaxGapDays] = useState(14);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stages, setStages] = useState<StageForm[]>([emptyStage(0), emptyStage(1), emptyStage(2)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStage = (): void => {
    if (stages.length >= 10) return;
    setStages([...stages, emptyStage(stages.length)]);
  };
  const removeStage = (idx: number): void => {
    if (stages.length <= 1) return;
    setStages(stages.filter((_, i) => i !== idx));
  };
  const updateStage = (idx: number, patch: Partial<StageForm>): void => {
    setStages(stages.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        durationMinutes: duration,
        bufferMinutes,
        maxGapDays,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        stages: stages.map((s, i) => ({
          order: i + 1,
          label: s.label.trim(),
          ownerEmail: s.ownerEmail.trim(),
          calendarIds: s.calendarIds
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        })),
      };
      const res = await fetch('/api/relay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { slug?: string; error?: { message?: string } };
      if (!res.ok || !data.slug) {
        throw new Error(data.error?.message ?? '作成に失敗しました');
      }
      router.push(`/relay/${data.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました');
      setSubmitting(false);
    }
  };

  return (
    <main className="wrap" style={{ padding: '24px 16px', maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>🔁 リレー型 リンク新規作成</h1>
      <p style={{ color: '#555', marginBottom: 24, fontSize: 14 }}>
        A→B→C と順番に全員と都合の合うスロットを連続で確保する、リレー型調整リンクを作成します。
      </p>

      {error && (
        <div style={{ background: '#fee', color: '#900', padding: 12, marginBottom: 16, borderRadius: 6 }}>
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <section style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            タイトル
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={inputStyle}
          />
        </section>

        <section style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelStyle}>所要時間（分）</label>
            <input
              type="number"
              min={5}
              max={480}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              required
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelStyle}>バッファ（分）</label>
            <input
              type="number"
              min={0}
              max={240}
              step={5}
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelStyle}>最大ギャップ（日）</label>
            <input
              type="number"
              min={1}
              max={365}
              value={maxGapDays}
              onChange={(e) => setMaxGapDays(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
        </section>

        <section style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={labelStyle}>期間 開始（任意）</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={labelStyle}>期間 終了（任意）</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={inputStyle}
            />
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>ステージ（順番）</h2>
          <p style={{ color: '#666', fontSize: 12, marginBottom: 12 }}>
            各ステージのowner emailと参照するGoogleカレンダーID（カンマ区切り・未指定は primary）を入力してください。
          </p>
          {stages.map((s, i) => (
            <div
              key={i}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 12,
                marginBottom: 8,
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: '#06c' }}>#{i + 1}</span>
                <input
                  value={s.label}
                  onChange={(e) => updateStage(i, { label: e.target.value })}
                  placeholder="ラベル"
                  style={{ ...inputStyle, flex: '0 0 120px' }}
                  required
                />
                <input
                  type="email"
                  value={s.ownerEmail}
                  onChange={(e) => updateStage(i, { ownerEmail: e.target.value })}
                  placeholder="owner@example.com"
                  style={{ ...inputStyle, flex: 1 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => removeStage(i)}
                  disabled={stages.length <= 1}
                  style={{ ...buttonStyle, background: '#f55', color: '#fff' }}
                >
                  削除
                </button>
              </div>
              <input
                value={s.calendarIds}
                onChange={(e) => updateStage(i, { calendarIds: e.target.value })}
                placeholder="primary,team@…"
                style={inputStyle}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addStage}
            disabled={stages.length >= 10}
            style={{ ...buttonStyle, background: '#eee', marginTop: 8 }}
          >
            ＋ ステージを追加
          </button>
        </section>

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...buttonStyle,
            background: '#06c',
            color: '#fff',
            fontWeight: 600,
            padding: '12px 24px',
            fontSize: 15,
            opacity: submitting ? 0.5 : 1,
          }}
        >
          {submitting ? '作成中…' : 'リンクを作成'}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
  background: '#fff',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
  color: '#444',
};
const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: 0,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};
