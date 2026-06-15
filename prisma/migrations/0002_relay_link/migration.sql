-- T6 リレー型独立リンク（A→B→C 順番調整）。
-- BookingPage(T1〜T6 全般) とは独立した軽量モデル。

-- CreateTable
CREATE TABLE "RelayLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "stages" JSONB NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxGapDays" INTEGER NOT NULL DEFAULT 14,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelayLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayLinkHold" (
    "id" TEXT NOT NULL,
    "relayLinkId" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL,
    "stageLabel" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisional',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelayLinkHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RelayLink_slug_key" ON "RelayLink"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RelayLinkHold_relayLinkId_stageOrder_startAt_key"
    ON "RelayLinkHold"("relayLinkId", "stageOrder", "startAt");

-- CreateIndex
CREATE INDEX "RelayLinkHold_relayLinkId_idx" ON "RelayLinkHold"("relayLinkId");

-- AddForeignKey
ALTER TABLE "RelayLinkHold"
    ADD CONSTRAINT "RelayLinkHold_relayLinkId_fkey"
    FOREIGN KEY ("relayLinkId") REFERENCES "RelayLink"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
