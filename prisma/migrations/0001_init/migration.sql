-- スケジュール調整ツール 初期マイグレーション
-- ★ ダブルブッキング物理防止（仕様 §12 強化）：
--   単なる UNIQUE ではなく PostgreSQL の EXCLUDE 制約（GiST + tstzrange &&）で
--   「同一リソース × 重なる時間帯」に active な Hold が2つできないことを DB が保証する。
--   半開区間 [start, end) を使うため端点共有は重複扱いしない（仕様 §7-3）。

-- 範囲型 GiST インデックスに必要
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- （enum / テーブル本体は `prisma migrate` が schema.prisma から生成する。
--   このファイルは EXCLUDE 制約という Prisma 非対応部分を補う追補マイグレーションとして適用する。）

-- Hold への排他制約：active なものだけを対象に、resource_id 一致かつ時間帯が重なる行を禁止
ALTER TABLE "Hold"
  ADD CONSTRAINT hold_no_double_booking
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status = 'active');

-- 補足：confirmed への遷移時は同一 (resourceId, timerange) の active が無いことが上の制約で保証済み。
-- TTL 失効（active → released）はアプリ側ジョブで行い、released/confirmed は制約対象外（部分制約）。
