import {
  Q96,
  MIN_TICK,
  MAX_TICK,
  priceToTick,
  tickToPrice,
  getAmountsForLiquidity,
  getLiquidityForAmounts,
  getAmountsDelta,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
} from "../position-math";

// ── tickToSqrtPriceX96 / sqrtPriceX96ToTick ──────────────────────────────────

describe("tickToSqrtPriceX96", () => {
  it("tick 0 returns Q96", () => {
    expect(tickToSqrtPriceX96(0)).toBe(Q96);
  });

  it("positive tick returns value > Q96", () => {
    expect(tickToSqrtPriceX96(100)).toBeGreaterThan(Q96);
  });

  it("negative tick returns value < Q96", () => {
    expect(tickToSqrtPriceX96(-100)).toBeLessThan(Q96);
  });

  it("throws on tick below MIN_TICK", () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow(RangeError);
  });

  it("throws on tick above MAX_TICK", () => {
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow(RangeError);
  });

  it("MIN_TICK and MAX_TICK do not throw", () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK)).not.toThrow();
    expect(() => tickToSqrtPriceX96(MAX_TICK)).not.toThrow();
  });
});

describe("sqrtPriceX96ToTick", () => {
  it("Q96 returns tick 0", () => {
    expect(sqrtPriceX96ToTick(Q96)).toBe(0);
  });

  it("price above Q96 returns positive tick", () => {
    expect(sqrtPriceX96ToTick(Q96 + Q96 / 100n)).toBeGreaterThan(0);
  });

  it("price below Q96 returns negative tick", () => {
    expect(sqrtPriceX96ToTick(Q96 - Q96 / 100n)).toBeLessThan(0);
  });

  it("throws on zero", () => {
    expect(() => sqrtPriceX96ToTick(0n)).toThrow(RangeError);
  });

  it("round-trips with tickToSqrtPriceX96 for tick 0", () => {
    const sqrt = tickToSqrtPriceX96(0);
    expect(sqrtPriceX96ToTick(sqrt)).toBe(0);
  });

  it("round-trips with tickToSqrtPriceX96 for positive tick", () => {
    const tick = 600;
    const sqrt = tickToSqrtPriceX96(tick);
    expect(sqrtPriceX96ToTick(sqrt)).toBe(tick);
  });

  it("round-trips with tickToSqrtPriceX96 for negative tick", () => {
    const tick = -600;
    const sqrt = tickToSqrtPriceX96(tick);
    expect(sqrtPriceX96ToTick(sqrt)).toBe(tick);
  });
});

// ── priceToTick ───────────────────────────────────────────────────────────────

describe("priceToTick", () => {
  it("price 1 returns tick 0 (snapped to spacing)", () => {
    expect(priceToTick(1, 1)).toBe(0);
  });

  it("price > 1 returns positive tick", () => {
    expect(priceToTick(2, 1)).toBeGreaterThan(0);
  });

  it("price < 1 returns negative tick", () => {
    expect(priceToTick(0.5, 1)).toBeLessThan(0);
  });

  it("snaps to tickSpacing", () => {
    const tick = priceToTick(1.5, 60);
    expect(tick % 60).toBe(0);
  });

  it("clamps to MIN_TICK", () => {
    expect(priceToTick(1e-40, 1)).toBe(MIN_TICK);
  });

  it("clamps to MAX_TICK", () => {
    expect(priceToTick(1e40, 1)).toBe(MAX_TICK);
  });

  it("throws on non-positive price", () => {
    expect(() => priceToTick(0, 1)).toThrow(RangeError);
    expect(() => priceToTick(-1, 1)).toThrow(RangeError);
  });
});

// ── tickToPrice ───────────────────────────────────────────────────────────────

describe("tickToPrice", () => {
  it("tick 0, equal decimals returns 1", () => {
    expect(tickToPrice(0, 6, 6)).toBeCloseTo(1, 10);
  });

  it("positive tick returns price > 1 (equal decimals)", () => {
    expect(tickToPrice(1000, 6, 6)).toBeGreaterThan(1);
  });

  it("negative tick returns price < 1 (equal decimals)", () => {
    expect(tickToPrice(-1000, 6, 6)).toBeLessThan(1);
  });

  it("adjusts for decimal difference", () => {
    // token0=6 decimals, token1=18 decimals → scale by 10^(6-18)
    const price = tickToPrice(0, 6, 18);
    expect(price).toBeCloseTo(1e-12, 5);
  });
});

// ── getAmountsForLiquidity ────────────────────────────────────────────────────

describe("getAmountsForLiquidity", () => {
  const sqrtLower = tickToSqrtPriceX96(-1000);
  const sqrtUpper = tickToSqrtPriceX96(1000);
  const sqrtMid = tickToSqrtPriceX96(0); // Q96
  const liquidity = 1_000_000n;

  it("zero liquidity returns zeros", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtMid,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity: 0n,
    });
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBe(0n);
  });

  it("price in range: both amounts > 0", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtMid,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    expect(r.amount0).toBeGreaterThan(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("price below range: only token0 (amount1 = 0)", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtLower - 1n,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    expect(r.amount0).toBeGreaterThan(0n);
    expect(r.amount1).toBe(0n);
  });

  it("price above range: only token1 (amount0 = 0)", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtUpper + 1n,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("price exactly at lower bound: amount1 = 0", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtLower,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    expect(r.amount1).toBe(0n);
    expect(r.amount0).toBeGreaterThan(0n);
  });

  it("price exactly at upper bound: amount0 = 0", () => {
    const r = getAmountsForLiquidity({
      sqrtPriceX96: sqrtUpper,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });
});

// ── getLiquidityForAmounts ────────────────────────────────────────────────────

describe("getLiquidityForAmounts", () => {
  const sqrtLower = tickToSqrtPriceX96(-1000);
  const sqrtUpper = tickToSqrtPriceX96(1000);
  const sqrtMid = Q96;

  it("price in range returns positive liquidity", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: sqrtMid,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      amount0: 1_000_000n,
      amount1: 1_000_000n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("price below range uses only amount0", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: sqrtLower - 1n,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      amount0: 1_000_000n,
      amount1: 0n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("price above range uses only amount1", () => {
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: sqrtUpper + 1n,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      amount0: 0n,
      amount1: 1_000_000n,
    });
    expect(liq).toBeGreaterThan(0n);
  });

  it("round-trips with getAmountsForLiquidity (in-range)", () => {
    const liquidity = 500_000n;
    const amounts = getAmountsForLiquidity({
      sqrtPriceX96: sqrtMid,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      liquidity,
    });
    const liq = getLiquidityForAmounts({
      sqrtPriceX96: sqrtMid,
      sqrtPriceLowerX96: sqrtLower,
      sqrtPriceUpperX96: sqrtUpper,
      amount0: amounts.amount0,
      amount1: amounts.amount1,
    });
    // Allow ±1 for integer division rounding
    expect(Number(liq - liquidity)).toBeGreaterThanOrEqual(-1);
    expect(Number(liq - liquidity)).toBeLessThanOrEqual(1);
  });
});

// ── getAmountsDelta ───────────────────────────────────────────────────────────

describe("getAmountsDelta", () => {
  const sqrtLower = tickToSqrtPriceX96(-500);
  const sqrtUpper = tickToSqrtPriceX96(500);
  const sqrtMid = Q96;
  const liquidity = 2_000_000n;

  it("in-range burn returns both tokens", () => {
    const r = getAmountsDelta({
      currentPrice: sqrtMid,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: liquidity,
    });
    expect(r.amount0).toBeGreaterThan(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("below-range burn returns only token0", () => {
    const r = getAmountsDelta({
      currentPrice: sqrtLower - 1n,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: liquidity,
    });
    expect(r.amount0).toBeGreaterThan(0n);
    expect(r.amount1).toBe(0n);
  });

  it("above-range burn returns only token1", () => {
    const r = getAmountsDelta({
      currentPrice: sqrtUpper + 1n,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: liquidity,
    });
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBeGreaterThan(0n);
  });

  it("zero liquidityDelta returns zeros", () => {
    const r = getAmountsDelta({
      currentPrice: sqrtMid,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: 0n,
    });
    expect(r.amount0).toBe(0n);
    expect(r.amount1).toBe(0n);
  });

  it("partial burn is proportional to full burn", () => {
    const full = getAmountsDelta({
      currentPrice: sqrtMid,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: liquidity,
    });
    const half = getAmountsDelta({
      currentPrice: sqrtMid,
      lowerPrice: sqrtLower,
      upperPrice: sqrtUpper,
      liquidityDelta: liquidity / 2n,
    });
    // half should be ~50% of full (allow ±1 for integer division)
    expect(Number(full.amount0 / 2n - half.amount0)).toBeLessThanOrEqual(1);
    expect(Number(full.amount1 / 2n - half.amount1)).toBeLessThanOrEqual(1);
  });
});
