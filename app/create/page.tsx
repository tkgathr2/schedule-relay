'use client';
/**
 * 空き時間リンク 作成画面（Spir の availability-sharing/create を研究して再現）。
 * 左＝設定フォーム／右＝週カレンダーで受付時間帯をプレビュー。保存で公開リンク発行。
 */
import { useMemo, useState } from 'react';
import '../scheduler.css';

const WEEK = ['月', '火', '水', '木', '金', '土', '日'];
const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8:00–20:00

function randSlug(): string {
  // 推測されにくい短いslug（決定論不要・UI生成）
  let s = '';
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function CreatePage() {
  const [adminTitle, setAdminTitle] = useState('');
  const [pubTitle, setPubTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [slug, setSlug] = useState(randSlug());
  const [duration, setDuration] = useState(30);
  const [wdOn, setWdOn] = useState(true);
  const [satOn, setSatOn] = useState(false);
  const [sunOn, setSunOn] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [weeks, setWeeks] = useState(2);
  const [startFrom, setStartFrom] = useState<'today' | 'tomorrow'>('tomorrow');
  const [bufBefore, setBufBefore] = useState(0);
  const [bufAfter, setBufAfter] = useState(10);

  const [saving, setSaving] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = adminTitle.trim() && pubTitle.trim() && slug.trim() && (wdOn || satOn || sunOn) && start < end;

  // 右カレンダーのプレビュー帯（受付時間帯）
  const band = useMemo(() => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const top = (sh + sm / 60 - 8) * 30;
    const h = (eh + em / 60 - (sh + sm / 60)) * 30;
    return { top: Math.max(0, top), h: Math.max(0, h) };
  }, [start, end]);

  const dayOn = (i: number) => (i <= 4 ? wdOn : i === 5 ? satOn : sunOn);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const range = [start, end];
      const settings = {
        title: pubTitle.trim(),
        description: desc.trim(),
        duration_minutes: duration,
        grid_minutes: 15,
        min_notice_minutes: startFrom === 'tomorrow' ? 1440 : 0,
        horizon_days: weeks * 7,
        buffer_minutes: { before: bufBefore, after: bufAfter },
        working_hours: {
          tz: 'Asia/Tokyo',
          mon_fri: wdOn ? range : [],
          sat: satOn ? range : [],
          sun: sunOn ? range : [],
        },
      };
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizerId: 'takagi', type: 'T1', slug: slug.trim(), settings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || '作成に失敗しました');
      const finalSlug = slug.trim();
      // ① 「最近作ったページ」を localStorage に保存（Auth.js無しでも自分の作成履歴が見える）
      try {
        const KEY = 'schedule-relay:my-pages';
        const prev = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown[];
        const filtered = Array.isArray(prev)
          ? prev.filter((p) => p && typeof p === 'object' && (p as { slug?: unknown }).slug !== finalSlug)
          : [];
        const entry = {
          slug: finalSlug,
          title: pubTitle.trim(),
          durationMin: duration,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem(KEY, JSON.stringify([entry, ...filtered].slice(0, 50)));
      } catch { /* localStorage 不可時は無視（プライベートブラウザ等） */ }
      setDoneUrl(`${window.location.origin}/b/${finalSlug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sc-wrap">
      <div className="sc-topbar">
        <div className="sc-logo"><span className="mk">📅</span>スケジュール調整くん</div>
        <div className="sc-spacer" />
        <span className="sc-pill">空き時間リンクを作成</span>
      </div>

      {doneUrl ? (
        <div style={{ maxWidth: 620, margin: '40px auto', padding: 20 }}>
          <div className="sc-done">
            <h3 style={{ margin: '0 0 8px' }}>✅ 空き時間リンクができました</h3>
            <p style={{ margin: 0, fontSize: 13 }}>このURLを相手に送るだけ。相手は空いている枠を選ぶだけで日程が決まります。繰り返し使えます。</p>
            <div className="sc-link">
              <input readOnly value={doneUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="sc-btn primary" style={{ flex: 'none' }} onClick={() => { navigator.clipboard.writeText(doneUrl); setCopied(true); }}>コピー</button>
            </div>
            {copied && <div className="sc-toast">コピーしました</div>}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <a className="sc-btn primary" style={{ textDecoration: 'none', display: 'inline-block' }} href={doneUrl}>予約ページを開く</a>
            <a className="sc-btn ghost" style={{ textDecoration: 'none', display: 'inline-block' }} href="/create" onClick={() => location.reload()}>もう1つ作る</a>
          </div>
        </div>
      ) : (
        <div className="sc-split">
          <div className="sc-form">
            <h1>空き時間リンク</h1>
            <p className="lead">空き時間をURLで共有。相手が1枠選ぶだけで確定します。繰り返し使えます。</p>

            <div className="sc-sec">基本</div>
            <div className="sc-field">
              <label>管理用タイトル<span className="req">*</span></label>
              <input className="sc-input" placeholder="例: 商談用（自分用メモ）" value={adminTitle} onChange={(e) => setAdminTitle(e.target.value)} />
              <div className="sc-help">自分の管理用。相手には表示されません。</div>
            </div>

            <div className="sc-sec">予約ページに表示する情報</div>
            <div className="sc-field">
              <label>予約ページタイトル<span className="req">*</span></label>
              <input className="sc-input" placeholder="例: 髙木産業 ご面談" value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} />
            </div>
            <div className="sc-field">
              <label>説明文</label>
              <textarea className="sc-textarea" placeholder="例: 空き時間を提示しています。ご都合の良い日時をお選びください。" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div className="sc-field">
              <label>公開URL</label>
              <div className="sc-row2" style={{ gridTemplateColumns: '1fr auto' }}>
                <input className="sc-input" value={slug} onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())} />
                <button className="sc-btn ghost" type="button" onClick={() => setSlug(randSlug())}>変更</button>
              </div>
              <div className="sc-help">/b/{slug || '...'}</div>
            </div>

            <div className="sc-sec">候補</div>
            <div className="sc-field">
              <label>打合せ時間</label>
              <select className="sc-select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d}分</option>)}
              </select>
            </div>
            <div className="sc-field">
              <label>受付する曜日</label>
              <div className="sc-days">
                {WEEK.map((d, i) => (
                  <div key={d} className={`sc-day ${dayOn(i) ? '' : 'off'}`} onClick={() => { if (i <= 4) setWdOn(!wdOn); else if (i === 5) setSatOn(!satOn); else setSunOn(!sunOn); }}>
                    <div className="d">{d}</div>
                    <div className="h">{dayOn(i) ? `${start.slice(0, 5)}-${end.slice(0, 5)}` : '休'}</div>
                  </div>
                ))}
              </div>
              <div className="sc-help">曜日をタップでON/OFF。月〜金はまとめて切替わります。</div>
            </div>
            <div className="sc-field">
              <label>受付時間帯</label>
              <div className="sc-row2">
                <input className="sc-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                <input className="sc-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="sc-field">
              <label>開始</label>
              <div className="sc-seg">
                <button className={startFrom === 'today' ? 'on' : ''} onClick={() => setStartFrom('today')}>今日から</button>
                <button className={startFrom === 'tomorrow' ? 'on' : ''} onClick={() => setStartFrom('tomorrow')}>明日から</button>
              </div>
            </div>
            <div className="sc-field">
              <label>期間</label>
              <select className="sc-select" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                <option value={1}>1週間分</option>
                <option value={2}>2週間分</option>
                <option value={4}>4週間分</option>
              </select>
            </div>
            <div className="sc-field">
              <label>前後の確保時間（バッファ）</label>
              <div className="sc-row2">
                <select className="sc-select" value={bufBefore} onChange={(e) => setBufBefore(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>前 {m}分</option>)}
                </select>
                <select className="sc-select" value={bufAfter} onChange={(e) => setBufAfter(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>後 {m}分</option>)}
                </select>
              </div>
            </div>
            {err && <div className="sc-err">{err}</div>}
          </div>

          <div className="sc-cal">
            <div className="sc-caltool">
              <strong className="ttl">プレビュー（受付時間帯）</strong>
              <span className="tz">🌐 Asia/Tokyo ・ {duration}分</span>
            </div>
            <div className="sc-grid">
              <div className="corner" />
              {WEEK.map((d, i) => (
                <div key={d} className="sc-dhead">
                  <div className="dw">{d}</div>
                  <div className="dn" style={{ color: dayOn(i) ? undefined : '#c0c5cd' }}>{dayOn(i) ? '受付' : '休'}</div>
                </div>
              ))}
              {HOURS.map((h) => (
                <div key={h} style={{ display: 'contents' }}>
                  <div className="sc-tcell">{h}:00</div>
                  {WEEK.map((d, i) => (
                    <div key={d} className="sc-cell">
                      {h === 8 && dayOn(i) && (
                        <div className="sc-slot" style={{ top: band.top, height: band.h, alignItems: 'flex-start', paddingTop: 2 }}>
                          受付
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="sc-legend">
              <span><i style={{ background: 'var(--sc-open)', border: '1px solid var(--sc-open-bd)' }} />受付する時間帯</span>
              <span>実際の空き枠は、あなたのカレンダーの予定を除いて相手に表示されます。</span>
            </div>
          </div>

          <div className="sc-savebar">
            <button className="sc-btn primary" disabled={!canSave || saving} onClick={save}>
              {saving ? '作成中…' : '空き時間リンクを作成'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
