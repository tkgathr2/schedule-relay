const DAYS = ['月', '火', '水', '木', '金'];
const TIMES = ['10:00', '10:30', '11:00', '11:30', '12:00'];

// デモ用の枠状態（free=空き / booked=予定あり / pick=選択中）
const CAL: Record<string, 'free' | 'booked' | 'pick'> = {
  '0-0': 'free', '1-0': 'free', '2-0': 'booked', '3-0': 'free', '4-0': 'free',
  '0-1': 'free', '1-1': 'pick', '2-1': 'booked', '3-1': 'free', '4-1': 'free',
  '0-2': 'booked', '1-2': 'free', '2-2': 'free', '3-2': 'free', '4-2': 'booked',
  '0-3': 'free', '1-3': 'free', '2-3': 'free', '3-3': 'booked', '4-3': 'free',
  '0-4': 'free', '1-4': 'booked', '2-4': 'free', '3-4': 'free', '4-4': 'free',
};

const TYPES = [
  { tag: 'T1', name: '空き時間リンク', desc: '空き枠をURLで共有。相手が1枠選ぶだけ。繰り返し使える。' },
  { tag: 'T2', name: '確定型', desc: '候補を提示して、選んだ瞬間に確定。' },
  { tag: 'T3', name: '投票型', desc: '複数候補に投票。3人以上の日程決めに。' },
  { tag: 'T4', name: 'チーム全員型', desc: 'チーム全員の共通の空きを自動で抽出。' },
  { tag: 'T5', name: 'チーム単数（RR）', desc: '担当を負荷分散で自動割当。' },
  { tag: 'T6', name: 'リレー型', desc: 'A→B→C と1人ずつ順番に確定。Spirにも無い独自機能。', must: true },
];

export default function Home() {
  return (
    <>
      <nav className="nav">
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0 }}>
          <div className="logo"><span className="mark">📅</span>スケジュール調整くん</div>
          <span className="url">schedule.takagi.bz</span>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="badge">Spirの全機能 ＋ リレー型調整</span>
          <h1>日程調整を、<span className="accent">1画面で</span>。<br />順番に決める<span className="accent">リレー型</span>もこれだけ。</h1>
          <p>Google・Microsoftカレンダーと連携。空き時間リンク・確定・投票・チーム調整に加えて、A→B→C と順番に決める「リレー型」調整ができる、唯一の日程調整ツール。</p>
          <div className="cta">
            <a className="btn primary" href="#calendar">空き枠を見る</a>
            <a className="btn ghost" href="#types">調整タイプを見る</a>
          </div>
        </div>
      </header>

      <section className="section" id="calendar">
        <div className="wrap">
          <h2>空きを見て、選んで、確定。</h2>
          <p className="lead">週カレンダーから空き枠をタップするだけ。タイムゾーンは自動。二重予約はシステムが物理的に防止します。</p>
          <div className="cal">
            <div className="cal-head">
              <span className="title">2026年6月15日(月) の週</span>
              <span className="tz">🌐 Asia/Tokyo (自動)</span>
            </div>
            <div className="grid">
              <div className="cell colhead"></div>
              {DAYS.map((d) => (<div key={d} className="cell colhead">{d}</div>))}
              {TIMES.map((t, row) => (
                <RowFragment key={t} time={t} row={row} />
              ))}
            </div>
          </div>
          <p className="lead" style={{ marginTop: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--brand)', fontWeight: 700 }}>■</span> 空き（選べる）
            <span style={{ color: 'var(--ok)', fontWeight: 700 }}>■</span> 選択中
            <span style={{ color: 'var(--muted)', fontWeight: 700 }}>■</span> 予定あり
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>🔴 リレー型（A→B→C）— ここが他に無い</h2>
          <p className="lead">「Aさんが決めたら、次にBさん、最後にCさん」と、1人ずつ順番に予定を確定。承認や順次面談がそのまま回せます。</p>
          <div className="relay">
            <strong>例：A → B → C で全員同じ枠に収束（converge）</strong>
            <div className="steps">
              <div className="step">
                <span className="dot done">A</span>
                <span className="label"><span className="who">高木</span><br /><span className="st">✓ 6/15 11:00 を確定</span></span>
              </div>
              <span className="bar fill" />
              <div className="step">
                <span className="dot active">B</span>
                <span className="label"><span className="who">脇本</span><br /><span className="st">いま確認中…</span></span>
              </div>
              <span className="bar" />
              <div className="step">
                <span className="dot wait">C</span>
                <span className="label"><span className="who">松本</span><br /><span className="st">順番待ち</span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="types">
        <div className="wrap">
          <h2>6つの調整タイプ</h2>
          <p className="lead">Spirの全機能（T1〜T5）に、リレー型（T6）を追加。用途で使い分けられます。</p>
          <div className="cards">
            {TYPES.map((t) => (
              <div key={t.tag} className={t.must ? 'fcard relay-card' : 'fcard'}>
                <span className="tag">{t.tag}</span>
                <h3>{t.name}</h3>
                <p>{t.desc}</p>
                {t.must && <span className="must">MUST・独自機能</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          スケジュール調整くん（プレビュー版）／ schedule.takagi.bz<br />
          高木産業グループ・CTO Agent Lab ｜ このページは画面プレビューです（バックエンド結線は順次）
        </div>
      </footer>
    </>
  );
}

function RowFragment({ time, row }: { time: string; row: number }) {
  return (
    <>
      <div className="cell timecol">{time}</div>
      {DAYS.map((_, col) => {
        const state = CAL[`${col}-${row}`] ?? 'free';
        const label = state === 'free' ? '空き' : state === 'pick' ? '選択中' : '—';
        return (
          <div className="cell" key={col}>
            <div className={`slot ${state}`}>{label}</div>
          </div>
        );
      })}
    </>
  );
}
