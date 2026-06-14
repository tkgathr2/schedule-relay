-- スケジュール調整ツール 初期マイグレーション
-- ★ ダブルブッキング物理防止（仕様 §12 強化）：
--   単なる UNIQUE ではなく PostgreSQL の EXCLUDE 制約（GiST + tstzrange &&）で
--   「同一リソース × 重なる時間帯」に active な Hold が2つできないことを DB が保証する。
--   半開区間 [start, end) を使うため端点共有は重複扱いしない（仕様 §7-3）。

-- 範囲型 GiST インデックスに必要
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- （enum / テーブル本体は `prisma migrate` が schema.prisma から生成する。
--   このファイルは EXCLUDE 制約という Prisma 非対応部分を補う追補マイグレーションとして適用する。）

-- Hold への排他制約：active または confirmed を対象に、resource_id 一致かつ時間帯が重なる行を禁止。
-- ★ confirmed（確定済み＝実予約）も対象に含める＝既に予約済みの枠に新たな Hold/確定を物理的に作れない。
--   （active だけだと「確定後の同一枠を別イベントが再予約できる」穴が残るため §12 の核を満たさない。）
ALTER TABLE "Hold"
  ADD CONSTRAINT hold_no_double_booking
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status IN ('active', 'confirmed'));

-- 補足：
-- ・active → confirmed の遷移は同一行が制約集合に留まるため自己衝突せず通る。
-- ・released は制約対象外（再取得可能）。
-- ・TTL 失効した active は別イベントの取得を阻害しないよう、アプリ側で速やかに released へ落とす
--   （取得時の遅延スイープ ＋ 定期ジョブ）。本番 Prisma 実装で holdSlot 前に期限切れ active を解放する。
