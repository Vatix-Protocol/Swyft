CREATE TABLE "tvl_alert_history" (
    "id" TEXT NOT NULL,
    "threshold_id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "owner_wallet" TEXT NOT NULL,
    "threshold_usd" DOUBLE PRECISION NOT NULL,
    "observed_tvl_usd" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "breached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tvl_alert_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tvl_alert_history_threshold_id_breached_at_idx"
    ON "tvl_alert_history"("threshold_id", "breached_at");

CREATE INDEX "tvl_alert_history_pool_id_breached_at_idx"
    ON "tvl_alert_history"("pool_id", "breached_at");

ALTER TABLE "tvl_alert_history"
    ADD CONSTRAINT "tvl_alert_history_threshold_id_fkey"
    FOREIGN KEY ("threshold_id") REFERENCES "tvl_alert_threshold"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
