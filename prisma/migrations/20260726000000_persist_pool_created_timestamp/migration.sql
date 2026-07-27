-- Persist the ledger close time (createdAt) from Horizon on pool.created events.
-- This allows us to accurately backfill Pool.createdAt for historical pools.

-- Add timestamp column to pool_created event table
ALTER TABLE "pool_created" ADD COLUMN "timestamp" TIMESTAMP;

-- Index on timestamp for efficient querying of pools created during time ranges
CREATE INDEX IF NOT EXISTS "pool_created_timestamp_idx" ON "pool_created"("timestamp");

-- Note: Existing pool.created events won't have timestamps. On next replay
-- or backfill run, Horizon will populate this field from ledger close time.
-- Pools created after this migration will have accurate createdAt values.
