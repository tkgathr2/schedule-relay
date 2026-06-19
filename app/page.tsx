'use client';
import { useState } from 'react';
import MyPages from './my-pages';

const DAYS = [
  { d: '月', date: '6/15' },
  { d: '火', date: '6/16' },
  { d: '水', date: '6/17' },
  { d: '木', date: '6/18' },
  { d: '金', date: '6/19' },
];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

type Ev = { day: number; start: number; len: number; title: string; kind: 'busy' | 'tentative' };
// 「自分のGoogle/Outlookカレンダーから同期された予定」（入っているように見える）
const EVENTS: Ev[] = [
  { day: 0, start: 9, len: 1, title: '朝礼', kind: 'busy' },
  { day: 0, start: 11, len: 1, title: '商談（A社）', kind: 'busy' },
  { day: 0, start: 15, len: 1, title: '1on1 脇本', kind: 'tentative' },
  { day: 1, start: 10, len: 2, title: '定例会議', kind: 'busy' },
  { day: 1, start: 14, len: 1, title: '採用面接', kind: 'busy' },
  { day: 2, start: 13, len: 2, title: '現場巡回', kind: 'busy' },
  { day: 3, start: 9, len: 1, title: '経営会議', kind: 'busy' },
  { day: 3, start: 16, len: 1, title: '取引先訪問', kind: 'tentative' },
  { day: 4, start: 11, len: 1, title: '月次レビュー', kind: 'busy' },
  { day: 4, start: 17, len: 1, title: '週次MTG', kind: 'busy' },
];
// 公開する「予約可能」枠（相手が選べる緑の枠）
const OPEN = new Set(['0-10', '0-14', '1-13', '2-10', '2-16', '3-11', '3-14', '4-9', '4-15']);

function evAt(day: number, hour: number): Ev | undefined {
  return EVENTS.find((e) => e.day === day && hour >= e.start && hour < e.start + e.len);
}
function evStart(day: number, hour: number): Ev | undefined {
  return EVENTS.find((e) => e.day === day && e.start === hour);
}

export default function Home() {
  const [picked, setPicked] = useState<string | null>('1-13');
  const [dur, setDur] = useState(30);

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <span className="badge">カレンダーと同期 ・ 1画面で日程調整</span>
          <h1>あなたの予定はそのまま。<br /><span className="accent">空いてる時間だけ</span>、相手に。</h1>
          <p>Google・Microsoftカレンダーと自動同期。入っている予定はそのまま見えて、空き枠だけを共有。二重予約は起きません。順番に決める<strong>リレー型</strong>もこれだけ。</p>
          <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="/create" style={{ background: '#2563eb', color: '#fff', textDecoration: 'none', fontWeight: 700, padding: '12px 22px', borderRadius: 10, fontSize: 15 }}>＋ 空き時間リンクを作る</a>
            <a href="/propose" style={{ background: '#fff', color: '#2563eb', textDecoration: 'none', fontWeight: 700, padding: '12px 22px', borderRadius: 10, fontSize: 15, border: '2px solid #2563eb' }}>＋ 候補を自動抽出して提案する</a>
            <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: 13 }}>URLを送るだけ・相手は1枠選ぶだけ</span>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="toolbar">
            <div className="tb-left">
              <button className="navbtn">‹</button>
              <strong>2026年 6月15日 - 19日</strong>
              <button className="navbtn">›</button>
              <span className="today">今日</span>
            </div>
            <div className="tb-right">
              <label className="durpick">所要
                <select value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                  <option value={15}>15分</option>
                  <option value={30}>30分</option>
                  <option value={45}>45分</option>
                  <option value={60}>60分</option>
                </select>
              </label>
              <span className="tz">🌐 Asia/Tokyo</span>
            </div>
          </div>

          <div className="cal2">
            <div className="cal2-grid">
              <div className="corner" />
              {DAYS.map((d) => (
                <div key={d.d} className="dayhead">
                  <span className="dnum">{d.date}</span><span className="dlabel">{d.d}</span>
                </div>
              ))}
              {HOURS.map((h) => (
                <Row key={h} hour={h} picked={picked} setPicked={setPicked} />
              ))}
            </div>
          </div>

          <div className="legend">
            <span><i className="lg busy" />予定あり（同期）</span>
            <span><i className="lg tent" />仮の予定</span>
            <span><i className="lg open" />予約可能（相手が選べる）</span>
            <span><i className="lg pick" />選択中</span>
          </div>
        </div>
      </section>

      <MyPages />

      <section className="section relaysec">
        <div className="wrap">
          <h2>🔴 リレー型（A→B→C）— Spirにも無い独自機能</h2>
          <p className="lead">「Aさんが決めたら次にBさん、最後にCさん」と1人ずつ順番に確定。承認・順次面談がそのまま回ります。</p>
          <div className="relay">
            <div className="steps">
              <div className="step"><span className="dot done">A</span><span className="label"><span className="who">高木</span><br /><span className="st">✓ 6/16 13:00 確定</span></span></div>
              <span className="bar fill" />
              <div className="step"><span className="dot active">B</span><span className="label"><span className="who">脇本</span><br /><span className="st">いま確認中…</span></span></div>
              <span className="bar" />
              <div className="step"><span className="dot wait">C</span><span className="label"><span className="who">松本</span><br /><span className="st">順番待ち</span></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>6つの調整タイプ（Spir全機能 ＋ リレー型）</h2>
          <div className="cards">
            {[
              { t: 'T1', n: '空き時間リンク', d: '空き枠をURLで共有。繰り返し使える。' },
              { t: 'T2', n: '確定型', d: '候補を選んだ瞬間に確定。' },
              { t: 'T3', n: '投票型', d: '複数候補に投票して決定。' },
              { t: 'T4', n: 'チーム全員型', d: 'チームの共通の空きを自動抽出。' },
              { t: 'T5', n: 'チーム単数（RR）', d: '担当を負荷分散で自動割当。' },
              { t: 'T6', n: 'リレー型', d: 'A→B→C と順番に確定。独自機能。', must: true },
            ].map((x) => (
              <div key={x.t} className={x.must ? 'fcard relay-card' : 'fcard'}>
                <span className="tag">{x.t}</span><h3>{x.n}</h3><p>{x.d}</p>
                {x.must && <span className="must">MUST・独自</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer><div className="wrap">スケ調くん（プレビュー版）／ schedule.takagi.bz ｜ 高木産業グループ・CTO Agent Lab</div></footer>
    </>
  );
}

function Row({ hour, picked, setPicked }: { hour: number; picked: string | null; setPicked: (v: string) => void }) {
  return (
    <>
      <div className="timecol">{hour}:00</div>
      {DAYS.map((_, day) => {
        const key = `${day}-${hour}`;
        const ev = evAt(day, hour);
        const head = evStart(day, hour);
        if (ev && !head) return <div key={day} className="c2 spanned" />; // 連続予定の2コマ目
        if (ev && head) {
          return (
            <div key={day} className="c2">
              <div className={`event ${ev.kind}`} style={{ height: `${ev.len * 46 - 6}px` }}>
                <b>{ev.start}:00</b> {ev.title}
              </div>
            </div>
          );
        }
        if (OPEN.has(key)) {
          const sel = picked === key;
          return (
            <div key={day} className="c2">
              <button className={`open ${sel ? 'sel' : ''}`} onClick={() => setPicked(key)}>
                {sel ? '✓ 選択中' : '予約可能'}
              </button>
            </div>
          );
        }
        return <div key={day} className="c2 empty" />;
      })}
    </>
  );
}
