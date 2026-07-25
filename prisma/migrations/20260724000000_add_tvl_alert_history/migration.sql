-- CreateTable
CREATE TABLE "tvl_alert_threshold" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "owner_wallet" TEXT NOT NULL,
    "threshold_usd" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tvl_alert_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tvl_snapshot" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "tvl_usd" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tvl_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tvl_alert_threshold_pool_id_owner_wallet_key" ON "tvl_alert_threshold"("pool_id", "owner_wallet");

-- CreateIndex
CREATE INDEX "tvl_alert_threshold_pool_id_idx" ON "tvl_alert_threshold"("pool_id");

-- CreateIndex
CREATE INDEX "tvl_alert_threshold_owner_wallet_idx" ON "tvl_alert_threshold"("owner_wallet");

-- CreateIndex
CREATE UNIQUE INDEX "tvl_snapshot_pool_id_date_key" ON "tvl_snapshot"("pool_id", "date");

-- CreateIndex
CREATE INDEX "tvl_snapshot_pool_id_date_idx" ON "tvl_snapshot"("pool_id", "date");

-- AddForeignKey
ALTER TABLE "tvl_alert_threshold" ADD CONSTRAINT "tvl_alert_threshold_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;