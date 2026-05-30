/**
 * Test coverage for concentrated-liquidity math — closes #203.
 *
 * Covers: getAmountsForLiquidity, getLiquidityForAmounts, getAmountsDelta,
 *         tickToSqrtPriceX96, sqrtPriceX96ToTick, priceToTick, tickToPrice.
 */

import {
  Q96,
  MIN_TICK,
  MAX_TICK,
  getAmountsForLiquidity,
  getLiquidityForAmounts,
  getAmountsDelta,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
  priceToTick,
  tickToPrice,
} from "../position-math";

// ── helpers ──────────────────────────────────────────────────────────────────

const SQRT_LOWER = Q96 - Q96 / 100n; // slightly below 1
const SQRT_UPPER = Q96 + Q96 / 100n; // slightly above 1
const SQRT_MID   = Q96;              // exactly at 1
const LIQUIDITY  = 1_000_000n;

// ── getAmountsForLiquidity ────────────────────────────────────────────────────

describe("getAmountsForLiquidity", () => {
  it("returns zero amounts for zero liquidity", () => {
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: 0n,
    });
    expect(amount0).toBe(0n);
    expect(amount1).toBe(0n);
  });

  it("returns positive amounts when price is in range", () => {
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY,
    });
    expect(amount0).toBeGreaterThan(0n);
    expect(amount1).toBeGreaterThan(0n);
  });

  it("returns only amount0 when price is below range", () => {
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_LOWER - 1n,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY,
    });
    expect(amount0).toBeGreaterThan(0n);
    expect(amount1).toBe(0n);
  });

  it("returns positive amount1 when price is above range", () => {
    const { amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_UPPER + 1n,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY,
    });
    expect(amount1).toBeGreaterThan(0n);
  });

  it("amounts scale proportionally with liquidity", () => {
    const base = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY,
    });
    const doubled = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY * 2n,
    });
    expect(doubled.amount0).toBe(base.amount0 * 2n);
    expect(doubled.amount1).toBe(base.amount1 * 2n);
  });
});

// ── getLiquidityForAmounts ────────────────────────────────────────────────────

describe("getLiquidityForAmounts", () => {
  it("returns positive liquidity for in-range price with both amounts", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      amount0: 1_000_000n,
      amount1: 1_000_000n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("returns positive liquidity when price is below range (only amount0 used)", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: SQRT_LOWER - 1n,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      amount0: 1_000_000n,
      amount1: 0n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("returns positive liquidity when price is above range (only amount1 used)", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: SQRT_UPPER + 1n,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      amount0: 0n,
      amount1: 1_000_000n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("roundtrip: recovered amounts do not exceed inputs", () => {
    const amount0 = 500_000n;
    const amount1 = 500_000n;
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      amount0,
      amount1,
    });
    const { amount0: out0, amount1: out1 } = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: liq,
    });
    expect(out0).toBeLessThanOrEqual(amount0);
    expect(out1).toBeLessThanOrEqual(amount1);
  });
});

// ── getAmountsDelta ───────────────────────────────────────────────────────────

describe("getAmountsDelta", () => {
  it("matches getAmountsForLiquidity for the same inputs", () => {
    const direct = getAmountsForLiquidity({
      sqrtPriceX96: SQRT_MID,
      sqrtPriceLowerX96: SQRT_LOWER,
      sqrtPriceUpperX96: SQRT_UPPER,
      liquidity: LIQUIDITY,
    });
    const delta = getAmountsDelta({
      currentPrice: SQRT_MID,
      lowerPrice: SQRT_LOWER,
      upperPrice: SQRT_UPPER,
      liquidityDelta: LIQUIDITY,
    });
    expect(delta.amount0).toBe(direct.amount0);
    expect(delta.amount1).toBe(direct.amount1);
  });

  it("returns zero amounts for zero liquidityDelta", () => {
    const { amount0, amount1 } = getAmountsDelta({
      currentPrice: SQRT_MID,
      lowerPrice: SQRT_LOWER,
      upperPrice: SQRT_UPPER,
      liquidityDelta: 0n,
    });
    expect(amount0).toBe(0n);
    expect(amount1).toBe(0n);
  });
});

// ── tickToSqrtPriceX96 ────────────────────────────────────────────────────────

describe("tickToSqrtPriceX96", () => {
  it("tick 0 → Q96", () => {
    expect(tickToSqrtPriceX96(0)).toBe(Q96);
  });

  it("positive tick → value greater than Q96", () => {
    expect(tickToSqrtPriceX96(1000)).toBeGreaterThan(Q96);
  });

  it("negative tick → value less than Q96", () => {
    expect(tickToSqrtPriceX96(-1000)).toBeLessThan(Q96);
  });

  it("throws RangeError below MIN_TICK", () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow(RangeError);
  });

  it("throws RangeError above MAX_TICK", () => {
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow(RangeError);
  });

  it("boundary ticks do not throw", () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK)).not.toThrow();
    expect(() => tickToSqrtPriceX96(MAX_TICK)).not.toThrow();
  });
});

// ── sqrtPriceX96ToTick ────────────────────────────────────────────────────────

describe("sqrtPriceX96ToTick", () => {
  it("Q96 → tick 0", () => {
    expect(sqrtPriceX96ToTick(Q96)).toBe(0);
  });

  it("price above Q96 → positive tick", () => {
    expect(sqrtPriceX96ToTick(Q96 + Q96 / 10n)).toBeGreaterThan(0);
  });

  it("price below Q96 → negative tick", () => {
    expect(sqrtPriceX96ToTick(Q96 - Q96 / 10n)).toBeLessThan(0);
  });

  it("throws RangeError for zero price", () => {
    expect(() => sqrtPriceX96ToTick(0n)).toThrow(RangeError);
  });

  it("roundtrip tick → sqrtPrice → tick is stable within ±1", () => {
    const tick = 500;
    const sqrtPrice = tickToSqrtPriceX96(tick);
    const recovered = sqrtPriceX96ToTick(sqrtPrice);
    expect(Math.abs(recovered - tick)).toBeLessThanOrEqual(1);
  });
});

// ── priceToTick ───────────────────────────────────────────────────────────────

describe("priceToTick", () => {
  it("price 1.0 → tick 0", () => {
    expect(priceToTick(1.0, 1)).toBe(0);
  });

  it("price > 1 → positive tick", () => {
    expect(priceToTick(2.0, 1)).toBeGreaterThan(0);
  });

  it("price < 1 → negative tick", () => {
    expect(priceToTick(0.5, 1)).toBeLessThan(0);
  });

  it("result is snapped to tickSpacing", () => {
    const spacing = 60;
    const tick = priceToTick(1.5, spacing);
    expect(tick % spacing).toBe(0);
  });

  it("throws RangeError for zero price", () => {
    expect(() => priceToTick(0, 1)).toThrow(RangeError);
  });

  it("throws RangeError for negative price", () => {
    expect(() => priceToTick(-1, 1)).toThrow(RangeError);
  });
});

// ── tickToPrice ───────────────────────────────────────────────────────────────

describe("tickToPrice", () => {
  it("tick 0 with equal decimals → price 1.0", () => {
    expect(tickToPrice(0, 6, 6)).toBeCloseTo(1.0, 5);
  });

  it("positive tick → price > 1 (equal decimals)", () => {
    expect(tickToPrice(1000, 6, 6)).toBeGreaterThan(1.0);
  });

  it("negative tick → price < 1 (equal decimals)", () => {
    expect(tickToPrice(-1000, 6, 6)).toBeLessThan(1.0);
  });

  it("decimal adjustment shifts price by expected factor", () => {
    // token0=6 decimals, token1=18 → factor = 10^(6-18) = 1e-12
    expect(tickToPrice(0, 6, 18)).toBeCloseTo(1e-12, 20);
  });
});
