/**
 * math-lib types — constructor contract tests (#1217)
 *
 * Covers the throwing `to*` constructors (exact MathErrorCode per rejection)
 * and the non-throwing `safeTo*` helpers (exact MATH_LIB_MESSAGES entry per
 * failure) at MIN_TICK, MAX_TICK, 0n and negative inputs.
 */

import {
  MATH_LIB_MESSAGES,
  MAX_TICK,
  MIN_TICK,
  MathErrorCode,
  MathLibResult,
  safeAmountDeltaParams,
  safeToLiquidity,
  safeToSqrtPriceX96,
  safeToTick,
  safeToTokenAmount,
  toLiquidity,
  toSqrtPriceX96,
  toTick,
  toTokenAmount,
} from './math-lib.types';

const Q96 = BigInt(1) << BigInt(96);

/** Runs `fn`, expecting it to throw a MathError, and returns that error's code. */
function errorCode(fn: () => unknown): number {
  try {
    fn();
  } catch (err) {
    const e = err as { name?: string; code?: number };
    expect(e.name).toBe('MathError');
    return e.code as number;
  }
  throw new Error('expected a MathError to be thrown');
}

function expectOk<T>(result: MathLibResult<T>, value: unknown): void {
  expect(result).toEqual({ ok: true, value });
}

function expectFail<T>(result: MathLibResult<T>, key: keyof typeof MATH_LIB_MESSAGES): void {
  expect(result).toEqual({ ok: false, message: MATH_LIB_MESSAGES[key] });
}

// ── Throwing constructors ─────────────────────────────────────────────────────

describe('toSqrtPriceX96', () => {
  it('accepts positive values, including prices below Q96', () => {
    expect(toSqrtPriceX96(BigInt(1))).toBe(BigInt(1));
    expect(toSqrtPriceX96(Q96)).toBe(Q96);
  });

  it('rejects 0n with PriceOutOfBounds', () => {
    expect(errorCode(() => toSqrtPriceX96(BigInt(0)))).toBe(MathErrorCode.PriceOutOfBounds);
  });

  it('rejects negative values with PriceOutOfBounds', () => {
    expect(errorCode(() => toSqrtPriceX96(BigInt(-1)))).toBe(MathErrorCode.PriceOutOfBounds);
  });
});

describe('toTick', () => {
  it('accepts MIN_TICK, 0 and MAX_TICK', () => {
    expect(toTick(MIN_TICK)).toBe(-887272);
    expect(toTick(0)).toBe(0);
    expect(toTick(MAX_TICK)).toBe(887272);
  });

  it('accepts negative ticks inside the range', () => {
    expect(toTick(-1)).toBe(-1);
  });

  it('rejects MIN_TICK - 1 with InvalidTick', () => {
    expect(errorCode(() => toTick(MIN_TICK - 1))).toBe(MathErrorCode.InvalidTick);
  });

  it('rejects MAX_TICK + 1 with InvalidTick', () => {
    expect(errorCode(() => toTick(MAX_TICK + 1))).toBe(MathErrorCode.InvalidTick);
  });

  it('rejects non-integers and NaN with InvalidTick', () => {
    expect(errorCode(() => toTick(1.5))).toBe(MathErrorCode.InvalidTick);
    expect(errorCode(() => toTick(NaN))).toBe(MathErrorCode.InvalidTick);
  });
});

describe('toLiquidity', () => {
  it('accepts 0n and positive values', () => {
    expect(toLiquidity(BigInt(0))).toBe(BigInt(0));
    expect(toLiquidity(BigInt(1000))).toBe(BigInt(1000));
  });

  it('rejects negative values with Underflow', () => {
    expect(errorCode(() => toLiquidity(BigInt(-1)))).toBe(MathErrorCode.Underflow);
  });
});

describe('toTokenAmount', () => {
  it('accepts 0n and positive values', () => {
    expect(toTokenAmount(BigInt(0))).toBe(BigInt(0));
    expect(toTokenAmount(BigInt(1000))).toBe(BigInt(1000));
  });

  it('rejects negative values with Underflow', () => {
    expect(errorCode(() => toTokenAmount(BigInt(-1)))).toBe(MathErrorCode.Underflow);
  });
});

// ── Safe (non-throwing) constructors ──────────────────────────────────────────

describe('safeToSqrtPriceX96', () => {
  it('returns ok for positive values', () => {
    expectOk(safeToSqrtPriceX96(BigInt(1)), BigInt(1));
    expectOk(safeToSqrtPriceX96(Q96), Q96);
  });

  it.each<[string, bigint | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['0n', BigInt(0)],
    ['negative', BigInt(-1)],
  ])('fails with missingPrice for %s', (_label, value) => {
    expectFail(safeToSqrtPriceX96(value), 'missingPrice');
  });
});

describe('safeToTick', () => {
  it('returns ok for MIN_TICK, 0, a negative tick and MAX_TICK', () => {
    expectOk(safeToTick(MIN_TICK), MIN_TICK);
    expectOk(safeToTick(0), 0);
    expectOk(safeToTick(-1), -1);
    expectOk(safeToTick(MAX_TICK), MAX_TICK);
  });

  it.each<[string, number | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['MIN_TICK - 1', MIN_TICK - 1],
    ['MAX_TICK + 1', MAX_TICK + 1],
    ['a non-integer', 1.5],
    ['NaN', NaN],
  ])('fails with missingTick for %s', (_label, value) => {
    expectFail(safeToTick(value), 'missingTick');
  });
});

describe('safeToLiquidity', () => {
  it('returns ok for 0n and positive values', () => {
    expectOk(safeToLiquidity(BigInt(0)), BigInt(0));
    expectOk(safeToLiquidity(BigInt(1000)), BigInt(1000));
  });

  it.each<[string, bigint | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['negative', BigInt(-1)],
  ])('fails with missingLiquidity for %s', (_label, value) => {
    expectFail(safeToLiquidity(value), 'missingLiquidity');
  });
});

describe('safeToTokenAmount', () => {
  it('returns ok for 0n and positive values', () => {
    expectOk(safeToTokenAmount(BigInt(0)), BigInt(0));
    expectOk(safeToTokenAmount(BigInt(1000)), BigInt(1000));
  });

  it.each<[string, bigint | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['negative', BigInt(-1)],
  ])('fails with missingAmount for %s', (_label, value) => {
    expectFail(safeToTokenAmount(value), 'missingAmount');
  });
});

describe('safeAmountDeltaParams', () => {
  it('returns ok with branded params when every field is valid', () => {
    expectOk(
      safeAmountDeltaParams({
        liquidity: BigInt(0),
        sqrtPriceLowerX96: BigInt(1),
        sqrtPriceUpperX96: Q96 * BigInt(2),
        sqrtPriceCurrentX96: Q96,
      }),
      {
        liquidity: BigInt(0),
        sqrtPriceLowerX96: BigInt(1),
        sqrtPriceUpperX96: Q96 * BigInt(2),
        sqrtPriceCurrentX96: Q96,
      }
    );
  });

  it('fails with missingLiquidity when liquidity is negative', () => {
    expectFail(
      safeAmountDeltaParams({
        liquidity: BigInt(-1),
        sqrtPriceLowerX96: BigInt(1),
        sqrtPriceUpperX96: Q96,
        sqrtPriceCurrentX96: Q96,
      }),
      'missingLiquidity'
    );
  });

  it('fails with missingPrice when a sqrt price is 0n', () => {
    expectFail(
      safeAmountDeltaParams({
        liquidity: BigInt(1),
        sqrtPriceLowerX96: BigInt(0),
        sqrtPriceUpperX96: Q96,
        sqrtPriceCurrentX96: Q96,
      }),
      'missingPrice'
    );
  });
});
