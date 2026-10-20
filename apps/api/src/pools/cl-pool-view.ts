import { Pool } from '@prisma/client';
import { ClPoolView } from './pool.types';

/** Tick spacing the cl-pool contract uses when a fee tier is not listed. */
export const DEFAULT_TICK_SPACING = 60;

/**
 * Fee tier (hundredths of a bip) → tick spacing. Mirrors
 * `fee_tier_to_tick_spacing` in packages/contract/contracts/cl-pool, which
 * fixes the spacing at pool initialization from the pool's fee tier.
 */
const TICK_SPACING_BY_FEE_TIER: Readonly<Record<number, number>> = {
  500: 10,
  3000: 60,
  10_000: 200,
};

export function tickSpacingForFeeTier(feeTier: number): number {
  return TICK_SPACING_BY_FEE_TIER[feeTier] ?? DEFAULT_TICK_SPACING;
}

/** Pool SoT columns the cl-pool view is derived from. */
export type ClPoolSource = Pick<
  Pool,
  'id' | 'currentSqrtPrice' | 'currentTick' | 'liquidity' | 'feeTier'
>;

/**
 * Builds the cl-pool view from the authoritative pool record. Every field is
 * read from (or, for tickSpacing, computed from) that record — there is no
 * independent cl-pool store — and the result is stamped with its provenance.
 */
export function deriveClPoolView(
  pool: ClPoolSource,
  derivedAt: number = Date.now(),
): ClPoolView {
  return {
    source: 'pool',
    derived: true,
    poolId: pool.id,
    derivedAt,
    sqrtPriceX96: pool.currentSqrtPrice,
    tick: pool.currentTick,
    liquidity: pool.liquidity,
    tickSpacing: tickSpacingForFeeTier(pool.feeTier),
  };
}
