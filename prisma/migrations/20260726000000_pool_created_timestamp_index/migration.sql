-- Index the pool creation event timestamp so pool lists can be sorted and
-- filtered by creation time without a full table scan.
CREATE INDEX IF NOT EXISTS "pool_created_createdAt_idx" ON "pool_created" ("createdAt");
