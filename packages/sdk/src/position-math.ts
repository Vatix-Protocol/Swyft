// Q64.96 fixed-point constant — mirrors on-chain Q96 = 1 << 96
export const Q96 = 1n << 96n;

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// log2(1.0001) / 2  ≈ 7.2134752e-5  scaled to fixed-point for tick ↔ sqrt price
// We use the same linear approximation as the cl-pool contract:
//   tick_to_sqrt_price(tick) = Q96 + tick * Q96 / 20000   (for tick >= 0)
//   sqrt_price_to_tick(sqrtPriceX96) ≈ (sqrtPriceX96 - Q96) * 20000 / Q96

/**
 * Converts a human-readable price (token1/token0) to the nearest valid tick,
 * snapped to the given tickSpacing.
 *
 * @param price - The price as token1/token0 (must be > 0)
 * @param tickSpacing - Tick spacing used by the pool (e.g. 60)
 * @returns The nearest tick index snapped to `tickSpacing` and clamped to valid bounds
 */
export function priceToTick(price: number, tickSpacing: number): number {
  if (price <= 0) throw new RangeError('price must be positive');
  // tick = log(price) / log(1.0001)
  const tick = Math.log(price) / Math.log(1.0001);
  const snapped = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, snapped));
}

/**
 * Converts a tick index to a human-readable price (token1/token0),
 * adjusted for token decimals.
 *
 * @param tick - Tick index to convert
 * @param token0Decimals - Decimals for token0
 * @param token1Decimals - Decimals for token1
 * @returns The price as a floating-point number (token1/token0)
 */
export function tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  // price = 1.0001^tick * 10^(token0Decimals - token1Decimals)
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

export interface AmountsForLiquidityParams {
  readonly sqrtPriceX96: bigint;
  readonly sqrtPriceLowerX96: bigint;
  readonly sqrtPriceUpperX96: bigint;
  readonly liquidity: bigint;
}

export interface AmountsResult {
  readonly amount0: bigint;
  readonly amount1: bigint;
}

/**
 * Returns token0 and token1 amounts for a given liquidity position.
 * Mirrors amounts_for_liquidity in cl-pool/src/lib.rs.
 *
 * @param params.sqrtPriceX96 - Current sqrt price in Q64.96 format
 * @param params.sqrtPriceLowerX96 - Lower bound sqrt price in Q64.96
 * @param params.sqrtPriceUpperX96 - Upper bound sqrt price in Q64.96
 * @param params.liquidity - Liquidity in integer Q64.96 units
 * @returns Object containing `amount0` and `amount1` as bigint
 */
export function getAmountsForLiquidity({
  sqrtPriceX96,
  sqrtPriceLowerX96,
  sqrtPriceUpperX96,
  liquidity,
}: AmountsForLiquidityParams): AmountsResult {
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };

  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // Price is below range: only amount0
    const amount0 = (liquidity * Q96) / sqrtPriceLowerX96 - (liquidity * Q96) / sqrtPriceUpperX96;
    return { amount0, amount1: 0n };
  } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
    // Price is above range: only amount1
    const amount1 = (liquidity * (sqrtPriceUpperX96 - sqrtPriceLowerX96)) / Q96;
    return { amount0: 0n, amount1 };
  } else {
    // Price is in range: both amounts
    const amount0 = (liquidity * Q96) / sqrtPriceLowerX96 - (liquidity * Q96) / sqrtPriceX96;
    const amount1 = (liquidity * (sqrtPriceX96 - sqrtPriceLowerX96)) / Q96;
    return { amount0, amount1 };
  }
}

export interface LiquidityForAmountsParams {
  readonly sqrtPriceX96: bigint;
  readonly sqrtPriceLowerX96: bigint;
  readonly sqrtPriceUpperX96: bigint;
  readonly amount0: bigint;
  readonly amount1: bigint;
}

/**
 * Returns the maximum liquidity achievable for the given token amounts and price range.
 *
 * @param params.sqrtPriceX96 - Current sqrt price in Q64.96 format
 * @param params.sqrtPriceLowerX96 - Lower bound sqrt price in Q64.96
 * @param params.sqrtPriceUpperX96 - Upper bound sqrt price in Q64.96
 * @param params.amount0 - token0 amount as bigint
 * @param params.amount1 - token1 amount as bigint
 * @returns The maximum liquidity (bigint)
 */
export function getLiquidityForAmounts({
  sqrtPriceX96,
  sqrtPriceLowerX96,
  sqrtPriceUpperX96,
  amount0,
  amount1,
}: LiquidityForAmountsParams): bigint {
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // Only token0 is used — price is below range
    // L = amount0 / (Q96/sqrtLower - Q96/sqrtUpper)
    //   = amount0 * sqrtLower * sqrtUpper / (Q96 * (sqrtUpper - sqrtLower))
    return (
      (amount0 * sqrtPriceLowerX96 * sqrtPriceUpperX96) /
      (Q96 * (sqrtPriceUpperX96 - sqrtPriceLowerX96))
    );
  } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
    // Only token1 is used — price is above range
    // L = amount1 * Q96 / (sqrtUpper - sqrtLower)
    return (amount1 * Q96) / (sqrtPriceUpperX96 - sqrtPriceLowerX96);
  } else {
    // Price is in range — take the minimum of both constraints
    const liq0 =
      (amount0 * sqrtPriceX96 * sqrtPriceUpperX96) / (Q96 * (sqrtPriceUpperX96 - sqrtPriceX96));
    const liq1 = (amount1 * Q96) / (sqrtPriceX96 - sqrtPriceLowerX96);
    return liq0 < liq1 ? liq0 : liq1;
  }
}

/**
 * Parameters for computing token amounts returned from a liquidity burn.
 *
 * All price fields are **Q64.96 fixed-point sqrt prices** — the same
 * representation used on-chain and by {@link AmountsForLiquidityParams}.
 */
export interface AmountsDeltaParams {
  /** Current sqrt price in Q64.96 format (sqrtPriceX96). */
  readonly sqrtPriceX96: bigint;
  /** Lower bound sqrt price in Q64.96 format. */
  readonly sqrtPriceLowerX96: bigint;
  /** Upper bound sqrt price in Q64.96 format. */
  readonly sqrtPriceUpperX96: bigint;
  /** Liquidity delta to burn — must be non-negative. */
  readonly liquidityDelta: bigint;
}

/**
 * Returns token amounts returned for a partial or full burn.
 * Equivalent to calling getAmountsForLiquidity with liquidityDelta.
 *
 * @param params.sqrtPriceX96 - current sqrtPrice (Q64.96)
 * @param params.sqrtPriceLowerX96 - lower sqrtPrice (Q64.96)
 * @param params.sqrtPriceUpperX96 - upper sqrtPrice (Q64.96)
 * @param params.liquidityDelta - liquidity to burn (bigint)
 * @returns Object with `amount0` and `amount1` as bigint
 */
export function getAmountsDelta({
  sqrtPriceX96,
  sqrtPriceLowerX96,
  sqrtPriceUpperX96,
  liquidityDelta,
}: AmountsDeltaParams): AmountsResult {
  return getAmountsForLiquidity({
    sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    liquidity: liquidityDelta,
  });
}

/**
 * Converts a tick to its Q64.96 sqrt price.
 * Mirrors tick_to_sqrt_price in cl-pool/src/lib.rs.
 *
 * @param tick - Tick index to convert
 * @returns Sqrt price in Q64.96 as bigint
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) throw new RangeError(`tick ${tick} out of bounds`);
  if (tick >= 0) {
    return Q96 + (BigInt(tick) * Q96) / 20000n;
  } else {
    const abs = BigInt(-tick);
    const sub = (abs * Q96) / 20000n;
    return sub >= Q96 ? 1n : Q96 - sub;
  }
}

/**
 * Converts a Q64.96 sqrt price to the nearest tick.
 * Mirrors sqrt_price_to_tick in cl-pool/src/lib.rs.
 *
 * @param sqrtPriceX96 - Sqrt price in Q64.96
 * @returns Tick index (number)
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) throw new RangeError('sqrtPriceX96 must be positive');
  if (sqrtPriceX96 >= Q96) {
    const ratio = sqrtPriceX96 - Q96;
    return Number((ratio * 20000n) / Q96);
  } else {
    const ratio = Q96 - sqrtPriceX96;
    return -Number((ratio * 20000n) / Q96);
  }
}

/**
 * Parameters for computing impermanent loss percentage.
 */
export interface ImpermanentLossParams {
  /** Current token0 amount (as number, post-decimals) */
  readonly amount0Current: number;
  /** Current token1 amount (as number, post-decimals) */
  readonly amount1Current: number;
  /** Initial token0 amount when position was created (as number, post-decimals) */
  readonly amount0Initial: number;
  /** Initial token1 amount when position was created (as number, post-decimals) */
  readonly amount1Initial: number;
  /** Current token0 price in terms of token1 */
  readonly token0Price: number;
  /** Current token1 price in terms of token0 (optional, derived from 1/token0Price if not provided) */
  readonly token1Price?: number;
}

/**
 * Calculates impermanent loss percentage for a liquidity position.
 *
 * Compares the value of the current position against a hypothetical "hodl" scenario
 * where the initial amounts were simply held without providing liquidity.
 *
 * **Assumptions:**
 * - Prices are in decimal-adjusted terms (10^decimals already factored in)
 * - The position value is calculated as: amount0 * token0Price + amount1 * token1Price
 * - A negative result means impermanent loss (position lost value)
 * - A positive result means impermanent gain
 *
 * @param params.amount0Current - Current token0 balance in the position
 * @param params.amount1Current - Current token1 balance in the position
 * @param params.amount0Initial - Initial token0 deposited when position was created
 * @param params.amount1Initial - Initial token1 deposited when position was created
 * @param params.token0Price - Current token0 price (token1 per token0)
 * @param params.token1Price - Current token1 price (token0 per token1), optional
 * @returns IL percentage, or null if calculation cannot be performed (e.g., zero initial value)
 */
export function getImpermanentLossPercentage({
  amount0Current,
  amount1Current,
  amount0Initial,
  amount1Initial,
  token0Price,
  token1Price: providedToken1Price,
}: ImpermanentLossParams): number | null {
  // Use provided token1Price or derive from token0Price
  const token1Price = providedToken1Price ?? (token0Price !== 0 ? 1 / token0Price : 0);

  // Calculate current position value
  const currentValue = amount0Current * token0Price + amount1Current * token1Price;

  // Calculate hodl value (what you'd have if you just held the initial amounts)
  const hodlValue = amount0Initial * token0Price + amount1Initial * token1Price;

  // Return null if hodl value is zero or negative (invalid scenario)
  if (hodlValue <= 0) return null;

  // IL% = (hodlValue / currentValue - 1) * 100
  const ilPercentage = ((hodlValue / currentValue - 1) * 100);

  return isFinite(ilPercentage) ? ilPercentage : null;
}
