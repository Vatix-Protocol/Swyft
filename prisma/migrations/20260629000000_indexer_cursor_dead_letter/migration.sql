CREATE TABLE IF NOT EXISTS "indexer_cursor" (
  "id" TEXT NOT NULL,
  "cursor" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "indexer_dead_letter" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "queueName" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "error" TEXT NOT NULL,
  "attemptsMade" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recoveredAt" TIMESTAMP(3),
  CONSTRAINT "indexer_dead_letter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "indexer_dead_letter_jobId_key" ON "indexer_dead_letter"("jobId");
CREATE INDEX IF NOT EXISTS "indexer_dead_letter_queueName_idx" ON "indexer_dead_letter"("queueName");
CREATE INDEX IF NOT EXISTS "indexer_dead_letter_createdAt_idx" ON "indexer_dead_letter"("createdAt");
