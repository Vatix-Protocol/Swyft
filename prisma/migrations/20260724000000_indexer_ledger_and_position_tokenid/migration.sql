-- Persist the source ledger on every raw event row so a replay can select
-- "everything from ledger N onward" directly from Postgres instead of
-- requiring an external re-fetch from Horizon.
ALTER TABLE "pool_created" ADD COLUMN "ledger" INTEGER;
ALTER TABLE "swap_processed" ADD COLUMN "ledger" INTEGER;
ALTER TABLE "position_minted" ADD COLUMN "ledger" INTEGER;
ALTER TABLE "position_burned" ADD COLUMN "ledger" INTEGER;
ALTER TABLE "fees_collected" ADD COLUMN "ledger" INTEGER;

CREATE INDEX IF NOT EXISTS "pool_created_ledger_idx" ON "pool_created"("ledger");
CREATE INDEX IF NOT EXISTS "swap_processed_ledger_idx" ON "swap_processed"("ledger");
CREATE INDEX IF NOT EXISTS "position_minted_ledger_idx" ON "position_minted"("ledger");
CREATE INDEX IF NOT EXISTS "position_burned_ledger_idx" ON "position_burned"("ledger");
CREATE INDEX IF NOT EXISTS "fees_collected_ledger_idx" ON "fees_collected"("ledger");

-- Position events didn't retain their NFT/position identifier, so a mint or
-- burn couldn't be distinguished from another in the same pool with the same
-- ticks when reprojecting the relational Position row on replay.
ALTER TABLE "position_minted" ADD COLUMN "tokenId" TEXT;
ALTER TABLE "position_burned" ADD COLUMN "tokenId" TEXT;
