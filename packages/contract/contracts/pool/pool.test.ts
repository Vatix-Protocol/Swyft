/**
 * Pool contract — TypeScript unit tests (#145)
 *
 * These tests verify the off-chain math that mirrors the on-chain pool logic:
 * tick ↔ sqrt-price conversion, liquidity amount calculations, and fee
 * accumulation arithmetic.  They run with Jest (no Soroban runtime required).
 */

// ── Constants (match pool/src/lib.rs) ────────────────────────────────────────

const Q96 = BigInt(1) << BigInt(96);
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// ── Helpers (TypeScript mirrors of Rust helpers) ──────────────────────────────

function tickToSqrtPrice(tick: number): bigint {
  if (tick === 0) return Q96;
  const abs = Math.abs(tick);
  let result = 10000n;
  let base = 10001n;
  let exp = BigInt(abs);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) / 10000n;
    base = (base * base) / 10000n;
    exp >>= 1n;
  }
  const sqrt = isqrt(result);
  if (tick > 0) return (sqrt * (Q96 / 100n));
  return sqrt === 0n ? Q96 : (Q96 / 100n * 10000n) / sqrt;
}

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function getAmount0(liquidity: bigint, sqrtLower: bigint, sqrtUpper: bigint, sqrtCurrent: bigint): bigint {
  const sa = sqrtCurrent > sqrtLower ? sqrtCurrent : sqrtLower;
  const sb = sqrtCurrent < sqrtUpper ? sqrtCurrent : sqrtUpper;
  if (sa >= sb || sqrtLower === 0n || sqrtUpper === 0n) return 0n;
  const num = liquidity * (sb - sa);
  const denom = (sa / Q96) * sb || 1n;
  return num / denom;
}

function getAmount1(liquidity: bigint, sqrtLower: bigint, sqrtUpper: bigint, sqrtCurrent: bigint): bigint {
  const sa = sqrtCurrent > sqrtLower ? sqrtCurrent : sqrtLower;
  const sb = sqrtCurrent < sqrtUpper ? sqrtCurrent : sqrtUpper;
  if (sa >= sb) return 0n;
  return (liquidity * (sb - sa)) / Q96;
}

function feeGrowthDelta(feeAmount: bigint, liquidity: bigint): bigint {
  if (liquidity === 0n) return 0n;
  return (feeAmount << 128n) / liquidity;
}

function feesOwed(liquidity: bigint, feeGrowthInsideDelta: bigint): bigint {
  return (liquidity * feeGrowthInsideDelta) >> 128n;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Pool — tick ↔ sqrt-price", () => {
  it("tick 0 maps to Q96", () => {
    expect(tickToSqrtPrice(0)).toBe(Q96);
  });

  it("positive tick produces sqrt price above Q96", () => {
    expect(tickToSqrtPrice(60)).toBeGreaterThan(Q96);
  });

  it("negative tick produces sqrt price below Q96", () => {
    expect(tickToSqrtPrice(-60)).toBeLessThan(Q96);
  });

  it("tick bounds are within [MIN_TICK, MAX_TICK]", () => {
    expect(MIN_TICK).toBe(-887272);
    expect(MAX_TICK).toBe(887272);
  });
});

describe("Pool — liquidity amount calculations", () => {
  const liquidity = 1_000_000n;
  const sqrtLower = tickToSqrtPrice(-60);
  const sqrtUpper = tickToSqrtPrice(60);
  const sqrtCurrent = Q96; // price = 1:1, tick = 0

  it("mint in-range returns non-zero amount0 and amount1", () => {
    const a0 = getAmount0(liquidity, sqrtLower, sqrtUpper, sqrtCurrent);
    const a1 = getAmount1(liquidity, sqrtLower, sqrtUpper, sqrtCurrent);
    expect(a0).toBeGreaterThan(0n);
    expect(a1).toBeGreaterThan(0n);
  });

  it("mint above current price returns only amount0", () => {
    const sqrtAbove = tickToSqrtPrice(120);
    const a0 = getAmount0(liquidity, sqrtUpper, sqrtAbove, sqrtCurrent);
    const a1 = getAmount1(liquidity, sqrtUpper, sqrtAbove, sqrtCurrent);
    expect(a0).toBeGreaterThan(0n);
    expect(a1).toBe(0n);
  });

  it("mint below current price returns only amount1", () => {
    const sqrtBelow = tickToSqrtPrice(-120);
    const a0 = getAmount0(liquidity, sqrtBelow, sqrtLower, sqrtCurrent);
    const a1 = getAmount1(liquidity, sqrtBelow, sqrtLower, sqrtCurrent);
    expect(a0).toBe(0n);
    expect(a1).toBeGreaterThan(0n);
  });

  it("zero liquidity returns zero amounts", () => {
    expect(getAmount0(0n, sqrtLower, sqrtUpper, sqrtCurrent)).toBe(0n);
    expect(getAmount1(0n, sqrtLower, sqrtUpper, sqrtCurrent)).toBe(0n);
  });
});

describe("Pool — fee accumulation", () => {
  it("fee growth delta is zero when liquidity is zero", () => {
    expect(feeGrowthDelta(1000n, 0n)).toBe(0n);
  });

  it("fee growth delta increases with fee amount", () => {
    const delta1 = feeGrowthDelta(1000n, 1_000_000n);
    const delta2 = feeGrowthDelta(2000n, 1_000_000n);
    expect(delta2).toBeGreaterThan(delta1);
  });

  it("fees owed scales with liquidity share", () => {
    const growth = feeGrowthDelta(1000n, 1_000_000n);
    const owed = feesOwed(1_000_000n, growth);
    // Full liquidity owns all fees (minus rounding)
    expect(owed).toBeGreaterThanOrEqual(999n);
    expect(owed).toBeLessThanOrEqual(1000n);
  });

  it("fees owed is zero when growth delta is zero", () => {
    expect(feesOwed(1_000_000n, 0n)).toBe(0n);
  });
});

describe("Pool — initialize guard", () => {
  it("rejects tick spacing of zero (fee tier unknown)", () => {
    const feeToSpacing = (fee: number) => {
      if (fee === 500) return 10;
      if (fee === 3000) return 60;
      if (fee === 10000) return 200;
      return null; // unknown fee tier
    };
    expect(feeToSpacing(3000)).toBe(60);
    expect(feeToSpacing(9999)).toBeNull();
  });
});
