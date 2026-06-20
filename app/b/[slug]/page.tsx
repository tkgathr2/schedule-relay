'use client';
/**
 * 公開予約ページ（相手が見る画面）。Spir の日程確定ページを研究して再現：
 *  週カレンダーで空き枠をタップ → 右パネルで名前/メールを入力 → 確定。
 * 既存の P2 API（availability → events → holds → confirm）に結線。
 */
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import '../../scheduler.css';
import CopyLinkButton from '../../_shared/CopyLinkButton';
import QrCodeButton from '../../_shared/QrCodeButton';
import IcalButton from '../../_shared/IcalButton';

const WEEK = ['月', '火', '水', '木', '金', '土', '日'];
const GRID_START = 8;
const GRID_END = 21;
const HOUR_PX = 34;
const TZ = 'Asia/Tokyo';

type Slot = { start: string; end: string };
type Meta = { title: string; description: string; durationMin: number; tz: string; organizerId: string };

function jstParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  let h = Number(p.hour);
  if (h === 24) h = 0;
  return { key: `${p.year}-${p.month}-${p.day}`, h, mi: Number(p.minute) };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' });
}

function weekDays(offsetWeeks: number) {
  const t = jstParts(new Date());
  const [y, mo, da] = t.key.split('-').map(Number);
  const base = new Date(Date.UTC(y, mo - 1, da));
  const dow = base.getUTCDay(); // 0=Sun..6=Sat
  base.setUTCDate(base.getUTCDate() - ((dow + 6) % 7) + offsetWeeks * 7);
  const days: { key: string; w: string; dn: string; isToday: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const yy = base.getUTCFullYear(), mm = base.getUTCMonth() + 1, dd = base.getUTCDate();
    const key = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    days.push({ key, w: WEEK[i], dn: `${mm}/${dd}`, isToday: key === t.key });
    base.setUTCDate(base.getUTCDate() + 1);
  }
  return days;
}

export default function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [week, setWeek] = useState(0);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ slot: Slot; meetUrl?: string | null; calendarEventLink?: string | null } | null>(null);

  const emailValid = /.+@.+/.test(email.trim());
  const canSubmit = !!picked && name.trim().length > 0 && emailValid;

  const [jumped, setJumped] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pages/${slug}/availability`);
      if (res.status === 404) { setNotFound(true); return; }
      const data = await res.json();
      setMeta(data.meta);
      const list: Slot[] = data.slots || [];
      setSlots(list);
      // 初回のみ：最初の空き枠がある週を開く（Spir同様、空週を見せない）
      if (!jumped && list.length) {
        const firstKey = jstParts(new Date(list[0].start)).key;
        for (let w = 0; w <= 8; w++) {
          if (weekDays(w).some((d) => d.key === firstKey)) { setWeek(w); break; }
        }
        setJumped(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug, jumped]);

  useEffect(() => { load(); }, [load]);

  // 随時更新：空き枠を静かに取り直す（ローディング表示なし・週位置や選択は維持）
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/pages/${slug}/availability`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setMeta(data.meta);
      setSlots(data.slots || []);
    } catch { /* 一時的な失敗は無視（次の周期で再取得） */ }
  }, [slug]);

  // 15秒ごと＋画面に戻ってきた時に最新化（誰かが取った枠が消える）
  useEffect(() => {
    if (notFound || done) return;
    const tick = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh(); };
    const id = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [refresh, notFound, done]);

  // 選択中の枠が更新で消えた＝他の人に取られた → 選択解除して知らせる
  useEffect(() => {
    if (picked && !slots.some((s) => s.start === picked.start && s.end === picked.end)) {
      setPicked(null);
      setErr('選択していた枠は、ちょうど他の方が予約しました。空いている別の枠をお選びください。');
    }
  }, [slots, picked]);

  const days = useMemo(() => weekDays(week), [week]);
  const slotsByDay = useMemo(() => {
    const m: Record<string, Slot[]> = {};
    for (const s of slots) {
      const p = jstParts(new Date(s.start));
      (m[p.key] ||= []).push(s);
    }
    return m;
  }, [slots]);

  const durMin = meta?.durationMin ?? 30;
  const weekHasSlots = days.some((d) => (slotsByDay[d.key] || []).length > 0);

  async function confirm() {
    if (!picked || !name.trim()) return;
    if (!emailValid) { setErr('メールアドレスの形式が正しくありません'); return; }
    setBusy(true); setErr(null);
    try {
      const idem = `${slug}-${email}-${picked.start}`;
      const evRes = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': idem },
        body: JSON.stringify({ slug }),
      });
      const ev = await evRes.json();
      if (!evRes.ok) throw new Error(ev?.error?.message || 'エラー');
      const eventId = ev.event.id;

      const hRes = await fetch(`/api/events/${eventId}/holds`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: picked, holderId: email.trim() }),
      });
      const h = await hRes.json();
      if (!hRes.ok) {
        if (h?.error?.code === 'CONFLICT_HOLD') throw new Error('申し訳ありません、この枠は今ちょうど埋まりました。別の枠をお選びください。');
        throw new Error(h?.error?.message || 'エラー');
      }

      const cRes = await fetch(`/api/events/${eventId}/confirm`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          holdId: h.hold.id,
          participantId: email.trim(),
          formAnswers: { name: name.trim(), email: email.trim(), note: note.trim() },
        }),
      });
      const c = await cRes.json();
      if (!cRes.ok) throw new Error(c?.error?.message || 'エラー');
      setDone({ slot: picked, meetUrl: c.meetUrl ?? null, calendarEventLink: c.calendarEventLink ?? null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'エラーが発生しました');
      // 衝突時は最新の空き状況を取り直す
      load();
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="sc-wrap"><div className="sc-topbar"><div className="sc-logo"><span className="mk">📅</span>スケジュール調整くん</div></div><div className="sc-empty">読み込み中…</div></div>;
  if (notFound) return <div className="sc-wrap"><div className="sc-topbar"><div className="sc-logo"><span className="mk">📅</span>スケジュール調整くん</div></div><div className="sc-empty">この予約ページは見つかりませんでした。</div></div>;

  return (
    <div className="sc-wrap">
      <div className="sc-topbar">
        <div className="sc-logo"><span className="mk">📅</span>スケジュール調整くん</div>
        <div className="sc-spacer" />
        <span className="sc-pill">{durMin}分</span>
      </div>

      <div className="sc-pub">
        <div className="sc-pubhead">
          <h1>{meta?.title}</h1>
          {meta?.description && <p style={{ margin: '0 0 8px', color: 'var(--sc-sub)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{meta.description}</p>}
          <div className="meta">
            <span>🕐 所要 {durMin}分</span>
            <span>🌐 Asia/Tokyo</span>
            <span
              style={{
                background: '#06c',
                color: '#fff',
                padding: '2px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 700,
              }}
              aria-label="空き候補件数"
            >
              候補 {slots.length} 件
            </span>
          </div>
          {!done && (
            <div className="sc-share">
              <CopyLinkButton path={`/b/${slug}`} />
              <QrCodeButton path={`/b/${slug}`} />
              <IcalButton url={`/api/b/${slug}/ical`} filename={`${slug}.ics`} />
            </div>
          )}
        </div>

        {done ? (
          <div style={{ padding: '0 20px 40px' }}>
            <div className="sc-done">
              <h3 style={{ margin: '0 0 8px' }}>✅ 予約が確定しました</h3>
              <p style={{ margin: 0 }}><strong>{fmtDate(done.slot.start)} {fmtTime(done.slot.start)}〜{fmtTime(done.slot.end)}</strong></p>
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>{name} 様（{email}）／ {meta?.title}</p>
              {done.meetUrl && (
                <p style={{ margin: '12px 0 0', fontSize: 13 }}>
                  会議URL: <a href={done.meetUrl} target="_blank" rel="noreferrer">{done.meetUrl}</a>
                </p>
              )}
              {done.calendarEventLink && (
                <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                  <a href={done.calendarEventLink} target="_blank" rel="noreferrer">Googleカレンダーで開く</a>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="sc-pubgrid">
            <div>
              <div className="sc-caltool">
                <button className="nav" onClick={() => setWeek((w) => Math.max(0, w - 1))} disabled={week === 0}>‹</button>
                <button className="nav" onClick={() => setWeek((w) => w + 1)}>›</button>
                <span className="ttl">{days[0].dn} 〜 {days[6].dn}</span>
                <span className="tz">空いている枠をお選びください</span>
              </div>
              <div className="sc-grid">
                <div className="corner" />
                {days.map((d) => (
                  <div key={d.key} className={`sc-dhead ${d.isToday ? 'today' : ''}`}>
                    <div className="dw">{d.w}</div><div className="dn">{d.dn}</div>
                  </div>
                ))}
                {Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i).map((h) => (
                  <div key={h} style={{ display: 'contents' }}>
                    <div className="sc-tcell">{h}:00</div>
                    {days.map((d) => (
                      <div key={d.key} className="sc-cell">
                        {h === GRID_START && (slotsByDay[d.key] || []).map((s) => {
                          const p = jstParts(new Date(s.start));
                          const top = (p.h + p.mi / 60 - GRID_START) * HOUR_PX;
                          const ht = Math.max(15, (durMin / 60) * HOUR_PX - 2);
                          const sel = picked?.start === s.start;
                          return (
                            <button key={s.start} className={`sc-slot ${sel ? 'sel' : ''}`}
                              style={{ top, height: ht }} onClick={() => { setPicked(s); setErr(null); }}>
                              {fmtTime(s.start)}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {!weekHasSlots && <div className="sc-empty">この週に空き枠はありません。「›」で次の週へ。</div>}
              <div className="sc-legend">
                <span><i style={{ background: '#10b981' }} />予約可能</span>
                <span><i style={{ background: 'var(--sc-sel)' }} />選択中</span>
              </div>
            </div>

            <div className="sc-panel">
              <h3>予約内容</h3>
              {picked ? (
                <>
                  <div className="sc-chosen">
                    <strong>{fmtDate(picked.start)}</strong><br />{fmtTime(picked.start)}〜{fmtTime(picked.end)}（{durMin}分）
                  </div>
                  <div className="sc-field">
                    <label>お名前<span className="req">*</span></label>
                    <input className="sc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="山田 太郎" />
                  </div>
                  <div className="sc-field">
                    <label>メールアドレス<span className="req">*</span></label>
                    <input className="sc-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                    {email.length > 0 && !emailValid && (
                      <div className="sc-help" style={{ color: '#b91c1c' }}>メール形式が正しくありません</div>
                    )}
                  </div>
                  <div className="sc-field">
                    <label>一言メモ（任意）</label>
                    <textarea
                      className="sc-textarea"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="例: 商談の前にこちらの資料を共有しておきます。"
                      rows={3}
                    />
                  </div>
                  {err && <div className="sc-err">{err}</div>}
                  <button className="sc-btn primary" style={{ width: '100%', marginTop: 8 }}
                    disabled={busy || !canSubmit} onClick={confirm}>
                    {busy ? '確定中…' : 'この日時で予約する'}
                  </button>
                </>
              ) : (
                <>
                  <div className="sc-empty">左のカレンダーから<br />空いている枠を選んでください。</div>
                  {err && <div className="sc-err">{err}</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
