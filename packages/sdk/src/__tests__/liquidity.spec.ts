import {
  estimateRemoveAmounts,
  estimateRemoveAmountsAsync,
  buildBurnTx,
  buildCollectTx,
} from "../liquidity";

// ---------------------------------------------------------------------------
// estimateRemoveAmounts
// ---------------------------------------------------------------------------

describe("estimateRemoveAmounts", () => {
  const LIQUIDITY = "1000000";
  const TICK_LOWER = -100;
  const TICK_UPPER = 100;

  it("returns non-negative amounts when price is within range", () => {
    const result = estimateRemoveAmounts(LIQUIDITY, 100, 1.0, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(result.amount0)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(result.amount1)).toBeGreaterThanOrEqual(0);
  });

  it("returns only amount0 when price is below lower tick", () => {
    // price well below lower tick → all token0
    const result = estimateRemoveAmounts(LIQUIDITY, 100, 0.00001, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(result.amount0)).toBeGreaterThan(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it("returns only amount1 when price is above upper tick", () => {
    // price well above upper tick → all token1
    const result = estimateRemoveAmounts(LIQUIDITY, 100, 100000, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBeGreaterThan(0);
  });

  it("scales linearly with removal percentage", () => {
    const full = estimateRemoveAmounts(LIQUIDITY, 100, 1.0, TICK_LOWER, TICK_UPPER);
    const half = estimateRemoveAmounts(LIQUIDITY, 50, 1.0, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(full.amount0)).toBeCloseTo(parseFloat(half.amount0) * 2, 5);
    expect(parseFloat(full.amount1)).toBeCloseTo(parseFloat(half.amount1) * 2, 5);
  });

  it("returns zero amounts for 0% removal", () => {
    const result = estimateRemoveAmounts(LIQUIDITY, 0, 1.0, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it("returns amounts with 7 decimal places", () => {
    const result = estimateRemoveAmounts(LIQUIDITY, 50, 1.0, TICK_LOWER, TICK_UPPER);
    expect(result.amount0).toMatch(/^\d+\.\d{7}$/);
    expect(result.amount1).toMatch(/^\d+\.\d{7}$/);
  });

  it("handles zero liquidity without throwing", () => {
    const result = estimateRemoveAmounts("0", 100, 1.0, TICK_LOWER, TICK_UPPER);
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// estimateRemoveAmountsAsync
// ---------------------------------------------------------------------------

describe("estimateRemoveAmountsAsync", () => {
  it("resolves to the same result as the sync version", async () => {
    const sync = estimateRemoveAmounts("500000", 75, 1.0, -200, 200);
    const async_ = await estimateRemoveAmountsAsync("500000", 75, 1.0, -200, 200);
    expect(async_).toEqual(sync);
  });

  it("returns a Promise", () => {
    const result = estimateRemoveAmountsAsync("1000000", 100, 1.0, -100, 100);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// buildBurnTx
// ---------------------------------------------------------------------------

describe("buildBurnTx", () => {
  it("returns a base64 XDR string and type burn", () => {
    const tx = buildBurnTx({
      positionId: "pos-1",
      poolId: "pool-1",
      liquidityBps: 5000,
      ownerAddress: "GABC",
    });
    expect(tx.type).toBe("burn");
    expect(typeof tx.xdr).toBe("string");
    expect(tx.xdr.length).toBeGreaterThan(0);
    // Must be valid base64
    expect(() => Buffer.from(tx.xdr, "base64")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildCollectTx
// ---------------------------------------------------------------------------

describe("buildCollectTx", () => {
  it("returns a base64 XDR string and type collect", () => {
    const tx = buildCollectTx({
      positionId: "pos-1",
      poolId: "pool-1",
      ownerAddress: "GABC",
    });
    expect(tx.type).toBe("collect");
    expect(typeof tx.xdr).toBe("string");
    expect(tx.xdr.length).toBeGreaterThan(0);
    expect(() => Buffer.from(tx.xdr, "base64")).not.toThrow();
  });
});
