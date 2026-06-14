-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('T1', 'T2', 'T3', 'T4', 'T5', 'T6');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'open', 'holding', 'confirmed', 'closed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('active', 'released', 'confirmed');

-- CreateEnum
CREATE TYPE "RelaySubMode" AS ENUM ('converge', 'chained', 'independent');

-- CreateEnum
CREATE TYPE "RelayStepStatus" AS ENUM ('waiting', 'active', 'done', 'skipped');

-- CreateTable
CREATE TABLE "BookingPage" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'open',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hold" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Confirmation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "formAnswers" JSONB,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayStep" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "subMode" "RelaySubMode" NOT NULL DEFAULT 'converge',
    "status" "RelayStepStatus" NOT NULL DEFAULT 'waiting',
    "deadline" TIMESTAMP(3),
    "slotStart" TIMESTAMP(3),
    "slotEnd" TIMESTAMP(3),

    CONSTRAINT "RelayStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingPage_slug_key" ON "BookingPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_idempotencyKey_key" ON "Event"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Candidate_eventId_idx" ON "Candidate"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_eventId_startAt_endAt_key" ON "Candidate"("eventId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Hold_eventId_idx" ON "Hold"("eventId");

-- CreateIndex
CREATE INDEX "Hold_resourceId_status_idx" ON "Hold"("resourceId", "status");

-- CreateIndex
CREATE INDEX "Confirmation_eventId_idx" ON "Confirmation"("eventId");

-- CreateIndex
CREATE INDEX "RelayStep_eventId_idx" ON "RelayStep"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RelayStep_eventId_order_key" ON "RelayStep"("eventId", "order");

-- CreateIndex
CREATE INDEX "Vote_eventId_idx" ON "Vote"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_eventId_candidateId_voterId_key" ON "Vote"("eventId", "candidateId", "voterId");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_idx" ON "AuditLog"("eventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BookingPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Confirmation" ADD CONSTRAINT "Confirmation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelayStep" ADD CONSTRAINT "RelayStep_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ★ ダブルブッキング物理防止（仕様 §12）：EXCLUDE 制約（GiST + range &&）
-- NOTE: startAt/endAt は Prisma の DateTime ＝ timestamp(3)（TZ無し・値はUTC）。
--   tstzrange は timestamptz を要求し型不一致で migration が失敗する（P3009の真因）。
--   列型に一致する tsrange を使う。保存値はすべてUTC由来なので半開区間 [) の重なり判定は同値。
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Hold"
  ADD CONSTRAINT hold_no_double_booking
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status IN ('active', 'confirmed'));
