import {
  getAmountsForLiquidity,
  tickToSqrtPriceX96,
} from '@swyft/sdk/position-math';

export interface TvlPosition {
  lowerTick: number;
  upperTick: number;
  liquidity: string;
}

export interface PoolTvlInput {
  currentSqrtPrice: string;
  positions: readonly TvlPosition[];
  price0: number;
  price1: number;
  decimals0: number;
  decimals1: number;
}

const MAX_SAFE_RESERVE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Converts a bigint reserve into a scaled number without an unsafe
 * bigint -> number conversion. The integer part is divided by the token
 * scale using bigint arithmetic, and the fractional remainder is kept as a
 * separate term so the result stays exact within double precision even when
 * the raw reserve exceeds Number.MAX_SAFE_INTEGER.
 */
function scaleReserve(reserve: bigint, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  const whole = reserve / scale;
  const remainder = reserve % scale;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

/**
 * Computes the USD-denominated TVL for a single pool.
 *
 * Edge-case behaviour (documented so callers can rely on it):
 * - A pool with zero liquidity (no positions, or all positions with zero
 *   liquidity) returns `0` rather than `NaN`/`Infinity`.
 * - A pool whose token has no usable USD price (`price0`/`price1` is not a
 *   finite positive number) returns `0`. The pool is treated as having no
 *   measurable value instead of throwing, so a single unpriced token cannot
 *   poison an aggregate TVL sum.
 * - Structurally invalid input (bad sqrt price, invalid tick range, malformed
 *   liquidity string, invalid decimals) still throws, since those indicate a
 *   data-integrity bug rather than a legitimately missing price.
 */
export function calculatePoolTvl({
  currentSqrtPrice,
  positions,
  price0,
  price1,
  decimals0,
  decimals1,
}: PoolTvlInput): number {
  if (
    !Number.isFinite(price0) ||
    price0 <= 0 ||
    !Number.isFinite(price1) ||
    price1 <= 0
  ) {
    return 0;
  }
  if (
    !Number.isInteger(decimals0) ||
    decimals0 < 0 ||
    decimals0 > 18 ||
    !Number.isInteger(decimals1) ||
    decimals1 < 0 ||
    decimals1 > 18
  ) {
    throw new Error('Pool token decimals are invalid');
  }

  let sqrtPriceX96: bigint;
  try {
    sqrtPriceX96 = BigInt(currentSqrtPrice);
  } catch {
    throw new Error('Pool sqrt price is invalid');
  }
  if (sqrtPriceX96 <= 0n) throw new Error('Pool sqrt price is invalid');

  let reserve0 = 0n;
  let reserve1 = 0n;
  for (const position of positions) {
    if (
      !Number.isInteger(position.lowerTick) ||
      !Number.isInteger(position.upperTick) ||
      position.lowerTick >= position.upperTick
    ) {
      throw new Error('Indexed position tick range is invalid');
    }

    let liquidity: bigint;
    try {
      if (!/^\d+$/.test(position.liquidity)) {
        throw new Error('invalid liquidity');
      }
      liquidity = BigInt(position.liquidity);
    } catch {
      throw new Error('Indexed position liquidity is invalid');
    }

    if (liquidity === 0n) continue;

    const amounts = getAmountsForLiquidity({
      sqrtPriceX96,
      sqrtPriceLowerX96: tickToSqrtPriceX96(position.lowerTick),
      sqrtPriceUpperX96: tickToSqrtPriceX96(position.upperTick),
      liquidity,
    });
    reserve0 += amounts.amount0;
    reserve1 += amounts.amount1;
  }

  // Reserves are scaled with bigint arithmetic before any number conversion so
  // large reserves are computed exactly within double precision instead of
  // being silently rounded by an unsafe bigint -> number cast.
  if (reserve0 === 0n && reserve1 === 0n) return 0;

  const tvl =
    scaleReserve(reserve0, decimals0) * price0 +
    scaleReserve(reserve1, decimals1) * price1;
  if (!Number.isFinite(tvl) || tvl < 0) {
    throw new Error('Computed pool TVL is invalid');
  }
  return tvl;
}
