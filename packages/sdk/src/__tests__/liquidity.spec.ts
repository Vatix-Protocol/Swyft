import {
  estimateRemoveAmounts,
  estimateRemoveAmountsAsync,
  buildBurnTx,
  buildCollectTx,
  RemoveAmountsParams,
} from "../liquidity";

// ---------------------------------------------------------------------------
// estimateRemoveAmounts
// ---------------------------------------------------------------------------

describe("estimateRemoveAmounts", () => {
  const LIQUIDITY = "1000000";
  const TICK_LOWER = -100;
  const TICK_UPPER = 100;

  const base: RemoveAmountsParams = {
    liquidity: LIQUIDITY,
    pct: 100,
    currentPrice: 1.0,
    lowerTick: TICK_LOWER,
    upperTick: TICK_UPPER,
  };

  it("returns non-negative amounts when price is within range", () => {
    const result = estimateRemoveAmounts(base);
    expect(parseFloat(result.amount0)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(result.amount1)).toBeGreaterThanOrEqual(0);
  });

  it("returns only amount0 when price is below lower tick", () => {
    // price well below lower tick → all token0
    const result = estimateRemoveAmounts({ ...base, currentPrice: 0.00001 });
    expect(parseFloat(result.amount0)).toBeGreaterThan(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it("returns only amount1 when price is above upper tick", () => {
    // price well above upper tick → all token1
    const result = estimateRemoveAmounts({ ...base, currentPrice: 100000 });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBeGreaterThan(0);
  });

  it("scales linearly with removal percentage", () => {
    const full = estimateRemoveAmounts({ ...base, pct: 100 });
    const half = estimateRemoveAmounts({ ...base, pct: 50 });
    expect(parseFloat(full.amount0)).toBeCloseTo(parseFloat(half.amount0) * 2, 5);
    expect(parseFloat(full.amount1)).toBeCloseTo(parseFloat(half.amount1) * 2, 5);
  });

  it("returns zero amounts for 0% removal", () => {
    const result = estimateRemoveAmounts({ ...base, pct: 0 });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it("returns amounts with 7 decimal places", () => {
    const result = estimateRemoveAmounts({ ...base, pct: 50 });
    expect(result.amount0).toMatch(/^\d+\.\d{7}$/);
    expect(result.amount1).toMatch(/^\d+\.\d{7}$/);
  });

  it("handles zero liquidity without throwing", () => {
    const result = estimateRemoveAmounts({ ...base, liquidity: "0" });
    expect(parseFloat(result.amount0)).toBe(0);
    expect(parseFloat(result.amount1)).toBe(0);
  });

  it("throws RangeError when pct is below 0", () => {
    expect(() => estimateRemoveAmounts({ ...base, pct: -1 })).toThrow(RangeError);
  });

  it("throws RangeError when pct is above 100", () => {
    expect(() => estimateRemoveAmounts({ ...base, pct: 101 })).toThrow(RangeError);
  });

  it("throws RangeError for non-finite liquidity", () => {
    expect(() => estimateRemoveAmounts({ ...base, liquidity: "NaN" })).toThrow(RangeError);
  });

  it("throws RangeError for Infinity liquidity string", () => {
    expect(() => estimateRemoveAmounts({ ...base, liquidity: "Infinity" })).toThrow(RangeError);
  });

  it("scales proportionally with liquidity amount", () => {
    const single = estimateRemoveAmounts(base);
    const triple = estimateRemoveAmounts({ ...base, liquidity: "3000000" });
    expect(parseFloat(triple.amount0)).toBeCloseTo(parseFloat(single.amount0) * 3, 5);
    expect(parseFloat(triple.amount1)).toBeCloseTo(parseFloat(single.amount1) * 3, 5);
  });
});

// ---------------------------------------------------------------------------
// estimateRemoveAmountsAsync
// ---------------------------------------------------------------------------

describe("estimateRemoveAmountsAsync", () => {
  const params: RemoveAmountsParams = {
    liquidity: "500000",
    pct: 75,
    currentPrice: 1.0,
    lowerTick: -200,
    upperTick: 200,
  };

  it("resolves to the same result as the sync version", async () => {
    const sync = estimateRemoveAmounts(params);
    const async_ = await estimateRemoveAmountsAsync(params);
    expect(async_).toEqual(sync);
  });

  it("returns a Promise", () => {
    const result = estimateRemoveAmountsAsync({
      liquidity: "1000000",
      pct: 100,
      currentPrice: 1.0,
      lowerTick: -100,
      upperTick: 100,
    });
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
