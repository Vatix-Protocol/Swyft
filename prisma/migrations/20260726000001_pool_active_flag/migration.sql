-- Soft activity flag for pools. Existing rows default to active.
ALTER TABLE "pool" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "pool_active_idx" ON "pool"("active");
