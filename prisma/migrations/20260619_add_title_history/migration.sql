-- CreateTable
CREATE TABLE "TitleHistory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TitleHistory_createdAt_idx" ON "TitleHistory"("createdAt");