-- RelayLink に作成者（User.id）を持たせる。
-- カレンダー資格情報はこの列からのみ解決し、stages[].ownerEmail は信頼しない
-- （2026-08-08 セキュリティレビュー H2：他人のメールを ownerEmail に書くだけで
--  他人のGoogleカレンダーの読み取り・予定作成・招待メール送信ができていた）。
-- 既存行は NULL のまま＝カレンダー連携オフ（degrade-safe / fail-closed）。

-- AlterTable
ALTER TABLE "RelayLink" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "RelayLink_createdByUserId_idx" ON "RelayLink"("createdByUserId");
