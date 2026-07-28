-- Add feeAmount column to swap table to store the fee charged per swap
ALTER TABLE "swap" ADD COLUMN IF NOT EXISTS "feeAmount" TEXT NOT NULL DEFAULT '0';
