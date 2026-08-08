# スケジュール調整くん（schedule-relay）

> **本番URL（予定）：https://schedule.takagi.bz**

Spir（spirinc.com）の全調整機能と同等以上を満たしつつ、Spirが最高プランでも持たない
**リレー型（A→B→C と1人ずつ順番に確定）** をマスト機能として備えた、決定論的スケジュール調整ツール「**スケジュール調整くん**」。

- 仕様書（正本 v1.2）：Notion「🗓️ スケジュール調整ツール 仕様書 v1.2・正本」
- 開発：CTO Agent Lab（開発部長 真田 啓）／ 台帳 CTO室-36（HO-124）

## スタック

| 層 | 採用 |
|---|---|
| アプリ | Next.js 15 (App Router) + TypeScript |
| DB | PostgreSQL + Prisma（Railway） |
| 認証 | **Auth.js (NextAuth v5) + Google OAuth**。`middleware.ts` が公開導線を除く全ページ・全APIをセッションで保護（default-deny）。セッションは **30日ローリング**（使い続ける限り再ログイン不要）。ログインできるのは `ALLOWED_EMAILS` に載ったアドレスのみで、**毎リクエスト再評価**される |
| 認可 | `organizerId` は**必ずサーバ側でセッションから引く**。クライアントから受け取らない（クエリ/ボディに入っていても無視する） |
| カレンダー | googleapis（freebusy）**マルチテナント**：カレンダーの中身はDBに保存せず、ログイン本人（または対象ページの主催者）の `Account.refresh_token` でその場でGoogle APIを叩く |
| テスト | vitest |

### 認証まわりの環境変数

| 変数 | 必須 | 用途 |
|---|---|---|
| `AUTH_SECRET` | ✅ | セッションJWTの署名鍵。`npx auth secret` で生成 |
| `NEXTAUTH_URL` | ✅(本番) | `https://schedule.takagi.bz`。OAuthコールバックURLの組み立てに使う |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | 既存のものを流用。Auth.js の `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` にもフォールバック |
| `ALLOWED_EMAILS` | ✅ | ログインを許可するメールアドレス（カンマ区切り）。**未設定なら誰もログインできない**（fail-closed） |
| `CRON_SECRET` | ✅ | `/api/auth/refresh-keepalive` を叩く月次cronの共有シークレット |
| `GOOGLE_CALENDAR_IDS` | 任意 | 既定 `auto`（そのユーザーの全カレンダー）。明示指定したい場合のみ |
| ~~`GOOGLE_REFRESH_TOKEN`~~ | ❌ 廃止 | 単一テナント時代の固定トークン。マルチテナント化で不要（削除してよい） |
| ~~`ADMIN_USER` / `ADMIN_PASS`~~ | ❌ 廃止 | 暫定Basic認証。Auth.js 一本化で不要（削除してよい） |

Google Cloud Console 側には **承認済みリダイレクトURI `https://schedule.takagi.bz/api/auth/callback/google`** の登録が必要。

**リフレッシュトークンの6ヶ月失効対策**：Googleのリフレッシュトークンは6ヶ月間一度も使われないと失効するため、
`GET /api/auth/refresh-keepalive`（`Authorization: Bearer $CRON_SECRET`）を月次cronで叩き、
全ユーザーのトークンを実際に使って生かし続ける。

**アカウントを即座に締め出したいとき**：`ALLOWED_EMAILS` から該当アドレスを外して再デプロイする。
middleware が毎リクエスト許可リストを再評価するので、既存セッションもその場で 403 になる
（`AUTH_SECRET` のローテーション＝全員強制ログアウト、は不要）。

**リレー型の担当者**：現フェーズでは `stages[].ownerEmail` に**自分以外を指定できない**。
他人のカレンダーを勝手に対象にできてしまうため、相手側が自分でログインして同意する
双方向フローが実装されるまでは作成者本人に限定している。

## 実装状況（仕様 §25 フェーズ）

### ✅ P1 基盤（このPRで実装・テスト green）
決定論の核を**純関数＋テスト**で確立（`src/domain/`）：

| モジュール | 役割 | 仕様 |
|---|---|---|
| `grid.ts` | 15分グリッド整列・半開区間の重なり・空き差分・枠列挙 | §7-2/§7-3 |
| `availability.ts` | 営業時間×busy×バッファ×直前ブロック→候補枠算出 | §6/§7/§12 |
| `tiebreak.ts` | 同点候補の一意決定（score→start→id・乱数不使用） | §7-5 |
| `roundrobin.ts` | 決定論ラウンドロビン（T5） | §7-7 |
| `relay.ts` | 🔴 T6リレー状態機械（converge/chained/independent・差し戻し） | §5 |
| `prisma/schema.prisma` + `0001_init/migration.sql` | データモデル＋**EXCLUDE制約でダブルブッキング物理防止** | §8/§12 |

**ダブルブッキング防止の要**：PostgreSQL の `EXCLUDE USING gist (resourceId WITH =, tstzrange(start,end,'[)') WITH &&) WHERE (status='active')`。
同一リソース×重なる時間帯に active な Hold を2つ作れないことを **DBが物理的に保証**する（アプリのロジックに依存しない）。

### ⏭ 次フェーズ（並行実装予定）
- P2: T1空き時間リンク / T2確定型 / 予約フォーム
- P3: T3投票型　P4: T4全員型 / T5 RR　P5: 🔴 T6リレー型（API/UI結線）
- P6: Spir風UI（週カレンダーグリッド・ステップバー・モバイル）
- P7: 通知/リマインド・i18n・監査・性能

## 開発

```bash
npm install
npm test          # vitest（ドメイン核 25テスト）
npm run typecheck # tsc --noEmit
```

## 設計原則

1. **時刻はUTC epoch ms**で計算（表示TZ変換は presentation 層。DST境界はIANA TZで解決）。
2. **半開区間 [start,end)**：端点共有は重複としない。
3. **乱数を使わない**：タイブレーク・RRは入力から一意に決まる＝同じ入力なら常に同じ結果。
4. **ダブルブッキングはDBで物理防止**（EXCLUDE制約）＝アプリのバグでも二重予約が起きない。
