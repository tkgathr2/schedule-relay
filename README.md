# schedule-relay — スケジュール調整ツール（Spir全機能＋リレー型T6）

Spir（spirinc.com）の全調整機能と同等以上を満たしつつ、Spirが最高プランでも持たない
**リレー型（A→B→C と1人ずつ順番に確定）** をマスト機能として備えた、決定論的スケジュール調整ツール。

- 仕様書（正本 v1.2）：Notion「🗓️ スケジュール調整ツール 仕様書 v1.2・正本」
- 開発：CTO Agent Lab（開発部長 真田 啓）／ 台帳 CTO室-36（HO-124）

## スタック

| 層 | 採用 |
|---|---|
| アプリ | Next.js 15 (App Router) + TypeScript |
| DB | PostgreSQL + Prisma（Railway） |
| 認証 | Auth.js（Google / Microsoft・セッション180日） |
| カレンダー | googleapis（freebusy）/ microsoft-graph（getSchedule） |
| テスト | vitest |

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
