-- CreateTable
CREATE TABLE "pool" (
    "id" TEXT NOT NULL,
    "token0Address" TEXT NOT NULL,
    "token1Address" TEXT NOT NULL,
    "feeTier" INTEGER NOT NULL,
    "currentSqrtPrice" TEXT NOT NULL,
    "currentTick" INTEGER NOT NULL,
    "liquidity" TEXT NOT NULL,
    "tvl" TEXT NOT NULL,
    "volume24h" TEXT NOT NULL,
    "feeApr" TEXT NOT NULL,
    "currentPrice" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "sqrtPriceAfter" TEXT NOT NULL,
    "tickAfter" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "feeAmount" TEXT NOT NULL DEFAULT '0',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "lowerTick" INTEGER NOT NULL,
    "upperTick" INTEGER NOT NULL,
    "liquidity" TEXT NOT NULL,
    "feesCollected0" TEXT NOT NULL DEFAULT '0',
    "feesCollected1" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tick" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tickIndex" INTEGER NOT NULL,
    "liquidityNet" TEXT NOT NULL,
    "liquidityGross" TEXT NOT NULL,
    "feeGrowthOutside0X128" TEXT NOT NULL DEFAULT '0',
    "feeGrowthOutside1X128" TEXT NOT NULL DEFAULT '0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "logoUri" TEXT,

    CONSTRAINT "token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "secret" TEXT,
    "largeSwapUsd" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "deliveryMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_candle" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volumeUsd" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_candle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_created" (
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tokenA" TEXT NOT NULL,
    "tokenB" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "sqrtPriceX96" TEXT NOT NULL,
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_created_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "swap_processed" (
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "sqrtPriceX96" TEXT NOT NULL,
    "liquidity" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swap_processed_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "position_minted" (
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tokenId" TEXT,
    "owner" TEXT NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "liquidity" TEXT NOT NULL,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_minted_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "position_burned" (
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tokenId" TEXT,
    "owner" TEXT NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "liquidity" TEXT NOT NULL,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_burned_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "fees_collected" (
    "eventId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "ledger" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fees_collected_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "indexer_cursor" (
    "id" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_audit_log" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_dead_letter" (
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

-- CreateTable
CREATE TABLE "tvl_alert_threshold" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "thresholdUsd" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tvl_alert_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tvl_alert_history" (
    "id" TEXT NOT NULL,
    "thresholdId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "thresholdUsd" DOUBLE PRECISION NOT NULL,
    "observedTvlUsd" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "breachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tvl_alert_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tvl_snapshot" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tvlUsd" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tvl_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pool_token0Address_token1Address_idx" ON "pool"("token0Address", "token1Address");

-- CreateIndex
CREATE INDEX "pool_createdAt_idx" ON "pool"("createdAt");

-- CreateIndex
CREATE INDEX "pool_active_idx" ON "pool"("active");

-- CreateIndex
CREATE UNIQUE INDEX "swap_eventId_key" ON "swap"("eventId");

-- CreateIndex
CREATE INDEX "swap_poolId_idx" ON "swap"("poolId");

-- CreateIndex
CREATE INDEX "swap_senderAddress_idx" ON "swap"("senderAddress");

-- CreateIndex
CREATE INDEX "swap_timestamp_idx" ON "swap"("timestamp");

-- CreateIndex
CREATE INDEX "swap_transactionHash_idx" ON "swap"("transactionHash");

-- CreateIndex
CREATE INDEX "position_poolId_idx" ON "position"("poolId");

-- CreateIndex
CREATE INDEX "position_ownerAddress_idx" ON "position"("ownerAddress");

-- CreateIndex
CREATE INDEX "position_createdAt_idx" ON "position"("createdAt");

-- CreateIndex
CREATE INDEX "position_closedAt_idx" ON "position"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "position_poolId_tokenId_key" ON "position"("poolId", "tokenId");

-- CreateIndex
CREATE INDEX "tick_poolId_tickIndex_idx" ON "tick"("poolId", "tickIndex");

-- CreateIndex
CREATE UNIQUE INDEX "tick_poolId_tickIndex_key" ON "tick"("poolId", "tickIndex");

-- CreateIndex
CREATE UNIQUE INDEX "token_address_key" ON "token"("address");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_hashedKey_key" ON "api_key"("hashedKey");

-- CreateIndex
CREATE INDEX "api_key_ownerWallet_idx" ON "api_key"("ownerWallet");

-- CreateIndex
CREATE INDEX "webhook_ownerWallet_idx" ON "webhook"("ownerWallet");

-- CreateIndex
CREATE INDEX "webhook_delivery_webhookId_idx" ON "webhook_delivery"("webhookId");

-- CreateIndex
CREATE INDEX "price_candle_poolId_interval_idx" ON "price_candle"("poolId", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "price_candle_poolId_interval_periodStart_key" ON "price_candle"("poolId", "interval", "periodStart");

-- CreateIndex
CREATE INDEX "pool_created_poolId_idx" ON "pool_created"("poolId");

-- CreateIndex
CREATE INDEX "pool_created_ledger_idx" ON "pool_created"("ledger");

-- CreateIndex
CREATE INDEX "swap_processed_poolId_createdAt_idx" ON "swap_processed"("poolId", "createdAt");

-- CreateIndex
CREATE INDEX "swap_processed_ledger_idx" ON "swap_processed"("ledger");

-- CreateIndex
CREATE INDEX "position_minted_poolId_idx" ON "position_minted"("poolId");

-- CreateIndex
CREATE INDEX "position_minted_ledger_idx" ON "position_minted"("ledger");

-- CreateIndex
CREATE INDEX "position_burned_poolId_idx" ON "position_burned"("poolId");

-- CreateIndex
CREATE INDEX "position_burned_ledger_idx" ON "position_burned"("ledger");

-- CreateIndex
CREATE INDEX "fees_collected_poolId_idx" ON "fees_collected"("poolId");

-- CreateIndex
CREATE INDEX "fees_collected_ledger_idx" ON "fees_collected"("ledger");

-- CreateIndex
CREATE INDEX "webhook_audit_log_webhookId_idx" ON "webhook_audit_log"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_audit_log_ownerWallet_idx" ON "webhook_audit_log"("ownerWallet");

-- CreateIndex
CREATE INDEX "admin_audit_log_actor_idx" ON "admin_audit_log"("actor");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_idx" ON "admin_audit_log"("action");

-- CreateIndex
CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "indexer_dead_letter_jobId_key" ON "indexer_dead_letter"("jobId");

-- CreateIndex
CREATE INDEX "indexer_dead_letter_queueName_idx" ON "indexer_dead_letter"("queueName");

-- CreateIndex
CREATE INDEX "indexer_dead_letter_createdAt_idx" ON "indexer_dead_letter"("createdAt");

-- CreateIndex
CREATE INDEX "tvl_alert_threshold_poolId_idx" ON "tvl_alert_threshold"("poolId");

-- CreateIndex
CREATE INDEX "tvl_alert_threshold_ownerWallet_idx" ON "tvl_alert_threshold"("ownerWallet");

-- CreateIndex
CREATE UNIQUE INDEX "tvl_alert_threshold_poolId_ownerWallet_key" ON "tvl_alert_threshold"("poolId", "ownerWallet");

-- CreateIndex
CREATE INDEX "tvl_alert_history_thresholdId_breachedAt_idx" ON "tvl_alert_history"("thresholdId", "breachedAt");

-- CreateIndex
CREATE INDEX "tvl_alert_history_poolId_breachedAt_idx" ON "tvl_alert_history"("poolId", "breachedAt");

-- CreateIndex
CREATE INDEX "tvl_snapshot_poolId_date_idx" ON "tvl_snapshot"("poolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tvl_snapshot_poolId_date_key" ON "tvl_snapshot"("poolId", "date");

-- AddForeignKey
ALTER TABLE "swap" ADD CONSTRAINT "swap_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_candle" ADD CONSTRAINT "price_candle_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tvl_alert_threshold" ADD CONSTRAINT "tvl_alert_threshold_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tvl_alert_history" ADD CONSTRAINT "tvl_alert_history_thresholdId_fkey" FOREIGN KEY ("thresholdId") REFERENCES "tvl_alert_threshold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tvl_snapshot" ADD CONSTRAINT "tvl_snapshot_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Trigram + full-text search support for token symbol/name lookups
-- (not representable in prisma/schema.prisma; carried over from the
-- pre-baseline migration history).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS token_symbol_gin_trgm_idx
  ON "token" USING gin ("symbol" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS token_name_gin_trgm_idx
  ON "token" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS token_symbol_fts_idx
  ON "token" USING gin (to_tsvector('simple', "symbol"));
