'use client';
/**
 * 🔴 T6 リレー型 進行ページ（最小UI・認証無し版）。
 *
 * URL: /r/{eventId}?step={stepId}&me={assigneeId}
 *  - ステップバー（A→B→C 進行ハイライト）
 *  - 現在ステップの「枠を確定する」ボタンと候補リスト
 *  - converge モードのときは「先頭が選んだ枠を受諾しますか？」を表示
 *
 * 本格認証（assigneeId 検証）は後段。最小実装＝URL クエリで本人を識別する。
 */
import { use, useCallback, useEffect, useState } from 'react';
import PoweredByFooter from '../../_shared/PoweredByFooter';

interface StepDto {
  id: string;
  order: number;
  assigneeId: string;
  subMode: 'converge' | 'chained' | 'independent';
  status: 'waiting' | 'active' | 'done' | 'skipped';
  deadline: string | null;
  slot: { start: number; end: number } | null;
}

function fmtSlot(slot: { start: number; end: number } | null): string {
  if (!slot) return '-';
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const opt: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  return `${s.toLocaleString('ja-JP', opt)}〜${e.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export default function RelayPage(props: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(props.params);
  const [steps, setSteps] = useState<StepDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myStepId, setMyStepId] = useState<string>('');
  const [meId, setMeId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [candidate, setCandidate] = useState<{ start: string; end: string }>({ start: '', end: '' });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setMyStepId(sp.get('step') ?? '');
    setMeId(sp.get('me') ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/events/${eventId}/relay`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`relay 取得に失敗（${r.status}）`);
      const data = (await r.json()) as { steps: StepDto[] };
      setSteps(data.steps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeStep = steps.find((s) => s.status === 'active');
  const firstDone = steps.find((s) => s.status === 'done' && s.slot);
  const isMyTurn =
    !!activeStep && (myStepId ? activeStep.id === myStepId : !!meId && activeStep.assigneeId === meId);
  const convergeForced =
    activeStep && activeStep.subMode === 'converge' && firstDone ? firstDone.slot : null;

  const submit = async () => {
    if (!activeStep) return;
    setSubmitting(true);
    setError(null);
    try {
      const slot = convergeForced
        ? { start: new Date(convergeForced.start).toISOString(), end: new Date(convergeForced.end).toISOString() }
        : { start: candidate.start, end: candidate.end };
      if (!slot.start || !slot.end) throw new Error('開始・終了を入力してください');
      const r = await fetch(`/api/events/${eventId}/relay/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId: activeStep.id, slot }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `エラー（${r.status}）`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信エラー');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>リレー型 日程調整</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        A → B → C と順番に枠を確定していきます。あなたの番になったら「枠を確定する」を押してください。
      </p>

      {loading && <div>読み込み中…</div>}
      {error && (
        <div role="alert" style={{ background: '#fee', color: '#900', padding: 8, borderRadius: 4, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* ステップバー */}
      <ol style={{ display: 'flex', listStyle: 'none', padding: 0, gap: 8, marginBottom: 24 }}>
        {steps.map((s) => {
          const bg =
            s.status === 'done'
              ? '#d4edda'
              : s.status === 'active'
                ? '#fff3cd'
                : s.status === 'skipped'
                  ? '#f8d7da'
                  : '#f0f0f0';
          const label = String.fromCharCode(65 + s.order); // A, B, C...
          return (
            <li
              key={s.id}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: bg,
                borderRadius: 4,
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 700 }}>{label}</div>
              <div style={{ color: '#555', wordBreak: 'break-all', fontSize: 11 }}>{s.assigneeId}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                {s.status === 'done' ? `✅ ${fmtSlot(s.slot)}` : s.status === 'active' ? '▶︎ あなたの番' : s.status}
              </div>
            </li>
          );
        })}
      </ol>

      {/* 自分の番のアクション */}
      {activeStep && isMyTurn && (
        <section style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>あなたの番です</h2>
          <p style={{ color: '#555', fontSize: 13 }}>
            サブモード: <code>{activeStep.subMode}</code>
          </p>
          {convergeForced ? (
            <>
              <p>
                Aさんが選んだ枠: <strong>{fmtSlot(convergeForced)}</strong>
              </p>
              <p>この枠を受諾しますか？</p>
              <button onClick={submit} disabled={submitting} style={btnPrimary}>
                受諾する
              </button>
            </>
          ) : (
            <>
              <p>枠の開始・終了（ISO 8601）を入力して確定してください。</p>
              <input
                type="datetime-local"
                value={candidate.start}
                onChange={(e) => setCandidate((c) => ({ ...c, start: e.target.value }))}
                style={inputStyle}
              />
              <span style={{ margin: '0 8px' }}>〜</span>
              <input
                type="datetime-local"
                value={candidate.end}
                onChange={(e) => setCandidate((c) => ({ ...c, end: e.target.value }))}
                style={inputStyle}
              />
              <div style={{ marginTop: 12 }}>
                <button onClick={submit} disabled={submitting} style={btnPrimary}>
                  枠を確定する
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {activeStep && !isMyTurn && (
        <section style={{ background: '#f8f9fa', padding: 16, borderRadius: 6 }}>
          現在は <strong>{activeStep.assigneeId}</strong> さんの番です。
        </section>
      )}

      {!activeStep && steps.length > 0 && (
        <section style={{ background: '#d4edda', padding: 16, borderRadius: 6 }}>
          全員の確定が完了しました。
        </section>
      )}
      <PoweredByFooter />
    </main>
  );
}

const btnPrimary: React.CSSProperties = {
  background: '#0070f3',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
};
