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
 */
export function priceToTick(price: number, tickSpacing: number): number {
  if (price <= 0) throw new RangeError("price must be positive");
  // tick = log(price) / log(1.0001)
  const tick = Math.log(price) / Math.log(1.0001);
  const snapped = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, snapped));
}

/**
 * Converts a tick index to a human-readable price (token1/token0),
 * adjusted for token decimals.
 */
export function tickToPrice(
  tick: number,
  token0Decimals: number,
  token1Decimals: number
): number {
  // price = 1.0001^tick * 10^(token0Decimals - token1Decimals)
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
}

export interface AmountsForLiquidityParams {
  sqrtPriceX96: bigint;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
  liquidity: bigint;
}

export interface AmountsResult {
  amount0: bigint;
  amount1: bigint;
}

/**
 * Returns token0 and token1 amounts for a given liquidity position.
 * Mirrors amounts_for_liquidity in cl-pool/src/lib.rs.
 */
export function getAmountsForLiquidity({
  sqrtPriceX96,
  sqrtPriceLowerX96,
  sqrtPriceUpperX96,
  liquidity,
}: AmountsForLiquidityParams): AmountsResult {
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };

  const sqrtCurrent =
    sqrtPriceX96 < sqrtPriceLowerX96
      ? sqrtPriceLowerX96
      : sqrtPriceX96 > sqrtPriceUpperX96
      ? sqrtPriceUpperX96
      : sqrtPriceX96;

  // amount0 = L * Q96 / sqrtLower - L * Q96 / sqrtUpper
  const amount0 =
    (liquidity * Q96) / sqrtPriceLowerX96 -
    (liquidity * Q96) / sqrtPriceUpperX96;

  // amount1 = L * (sqrtCurrent - sqrtLower) / Q96
  const amount1 = (liquidity * (sqrtCurrent - sqrtPriceLowerX96)) / Q96;

  return { amount0, amount1 };
}

export interface LiquidityForAmountsParams {
  sqrtPriceX96: bigint;
  sqrtPriceLowerX96: bigint;
  sqrtPriceUpperX96: bigint;
  amount0: bigint;
  amount1: bigint;
}

/**
 * Returns the maximum liquidity achievable for the given token amounts and price range.
 * Mirrors the inverse of amounts_for_liquidity.
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
      (amount0 * sqrtPriceX96 * sqrtPriceUpperX96) /
      (Q96 * (sqrtPriceUpperX96 - sqrtPriceX96));
    const liq1 = (amount1 * Q96) / (sqrtPriceX96 - sqrtPriceLowerX96);
    return liq0 < liq1 ? liq0 : liq1;
  }
}

export interface AmountsDeltaParams {
  currentPrice: bigint;   // sqrtPriceX96
  lowerPrice: bigint;     // sqrtPriceLowerX96
  upperPrice: bigint;     // sqrtPriceUpperX96
  liquidityDelta: bigint; // liquidity to burn (positive)
}

/**
 * Returns token amounts returned for a partial or full burn.
 * Equivalent to calling getAmountsForLiquidity with liquidityDelta.
 */
export function getAmountsDelta({
  currentPrice,
  lowerPrice,
  upperPrice,
  liquidityDelta,
}: AmountsDeltaParams): AmountsResult {
  return getAmountsForLiquidity({
    sqrtPriceX96: currentPrice,
    sqrtPriceLowerX96: lowerPrice,
    sqrtPriceUpperX96: upperPrice,
    liquidity: liquidityDelta,
  });
}

/**
 * Converts a tick to its Q64.96 sqrt price.
 * Mirrors tick_to_sqrt_price in cl-pool/src/lib.rs.
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK)
    throw new RangeError(`tick ${tick} out of bounds`);
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
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) throw new RangeError("sqrtPriceX96 must be positive");
  if (sqrtPriceX96 >= Q96) {
    const ratio = sqrtPriceX96 - Q96;
    return Number((ratio * 20000n) / Q96);
  } else {
    const ratio = Q96 - sqrtPriceX96;
    return -Number((ratio * 20000n) / Q96);
  }
}
