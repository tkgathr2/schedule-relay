'use client';
/**
 * /confirmed — 確定済の予定一覧（Spir同等）。
 * GET /api/confirmations?organizerId=takagi&from=YYYY-MM-DD をデータ源にテーブル表示。
 * CSV ダウンロードは GET /api/confirmations/csv?organizerId=takagi。
 */
import { useCallback, useEffect, useState } from 'react';

type ConfRow = {
  id: string;
  eventId: string;
  participantId: string;
  start: number;
  end: number;
  confirmedAt: number;
  event: { id: string; pageId: string } | null;
  page: { id: string; organizerId: string; settings: { title?: string } | null } | null;
};

const ORGANIZER_ID = 'takagi';
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n: number): string { return String(n).padStart(2, '0'); }

function fmtRange(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getFullYear()}/${pad(s.getMonth() + 1)}/${pad(s.getDate())}(${DOW[s.getDay()]}) ${pad(s.getHours())}:${pad(s.getMinutes())}-${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function todayJstYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function ConfirmedPage() {
  const [confs, setConfs] = useState<ConfRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ organizerId: ORGANIZER_ID });
      if (!showPast) params.set('from', todayJstYmd());
      const r = await fetch(`/api/confirmations?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as { confirmations: ConfRow[] };
      // 化け文字（U+FFFD）を含む title はレガシー破損データ扱いで一覧から除外
      const clean = (j.confirmations || []).filter((c) => {
        const t = (c as unknown as { title?: unknown }).title;
        if (typeof t !== 'string') return true;
        return !t.includes('�');
      });
      setConfs(clean);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '読み込みに失敗しました');
      setConfs([]);
    }
  }, [showPast]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvUrl = `/api/confirmations/csv?organizerId=${ORGANIZER_ID}`;

  return (
    <main className="sc-list-page">
      <div className="wrap">
        <div className="sc-list-head">
          <div>
            <h1>確定済の予定</h1>
            <div className="sub">調整が確定し、カレンダーに登録された予定の一覧です。</div>
          </div>
          <a href={csvUrl} className="sc-btn-secondary" download>
            CSV ダウンロード
          </a>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            読み込みエラー：{err}
          </div>
        )}

        {confs === null ? (
          <div className="sc-list-card"><div className="sc-list-empty">読み込み中…</div></div>
        ) : confs.length === 0 ? (
          <div className="sc-list-card">
            <div className="sc-list-empty">
              <h3>{showPast ? '確定済の予定はありません' : '今日以降の確定済の予定はありません'}</h3>
              <p>調整が確定するとここに予定が並びます。</p>
            </div>
          </div>
        ) : (
          <div className="sc-list-card">
            <table className="sc-list-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>タイトル</th>
                  <th>主催者</th>
                </tr>
              </thead>
              <tbody>
                {confs.map((c) => {
                  const title = c.page?.settings?.title || '(無題)';
                  const organizer = c.page?.organizerId || '—';
                  return (
                    <tr key={c.id}>
                      <td>{fmtRange(c.start, c.end)}</td>
                      <td className="cell-title">{title}</td>
                      <td className="cell-muted">{organizer}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="sc-btn-ghost" onClick={() => setShowPast((v) => !v)}>
            {showPast ? '今日以降のみ表示' : '過去の予定を表示'}
          </button>
        </div>
      </div>
    </main>
  );
}
