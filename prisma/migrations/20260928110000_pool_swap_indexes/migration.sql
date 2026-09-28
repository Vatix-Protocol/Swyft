-- Add the indexes declared by the Pool and Swap Prisma models.
CREATE INDEX "pool_token0Address_token1Address_idx"
  ON "pool"("token0Address", "token1Address");
CREATE INDEX "pool_createdAt_idx" ON "pool"("createdAt");
CREATE INDEX "pool_active_idx" ON "pool"("active");

CREATE INDEX "swap_poolId_idx" ON "swap"("poolId");
CREATE INDEX "swap_senderAddress_idx" ON "swap"("senderAddress");
CREATE INDEX "swap_timestamp_idx" ON "swap"("timestamp");
CREATE INDEX "swap_transactionHash_idx" ON "swap"("transactionHash");
