/**
 * 公開ページ（相手が見る画面）の下部に出す「Powered by スケ調くん」ブランディング。
 * Calendly等の外部予約ツール同様、招待された相手にもツールの存在が伝わるようにする。
 */
export default function PoweredByFooter() {
  return (
    <div className="sc-powered-by">
      <a href="https://schedule.takagi.bz" target="_blank" rel="noreferrer">
        <span className="mk">📅</span>Powered by スケ調くん
      </a>
    </div>
  );
}
