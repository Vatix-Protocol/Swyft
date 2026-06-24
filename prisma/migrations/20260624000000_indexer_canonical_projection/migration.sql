-- Canonical projections for the event indexer. Existing rows receive their
-- deterministic primary key as the event key so the unique constraint can be
-- introduced without data loss.
ALTER TABLE "swap" ADD COLUMN "eventId" TEXT;
UPDATE "swap" SET "eventId" = "id" WHERE "eventId" IS NULL;
ALTER TABLE "swap" ALTER COLUMN "eventId" SET NOT NULL;
CREATE UNIQUE INDEX "swap_eventId_key" ON "swap"("eventId");

CREATE UNIQUE INDEX "position_poolId_tokenId_key" ON "position"("poolId", "tokenId");

CREATE TABLE "indexer_cursor" (
  "id" TEXT NOT NULL,
  "cursor" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("id")
);
