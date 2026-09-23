/**
 * Strict TypeScript types for the math-lib Soroban contract.
 *
 * These types mirror the Rust structs and enums in math-lib/src/lib.rs and
 * are used by the TypeScript integration layer (scripts, SDK, tests).
 *
 * Closes #204 — Improve TypeScript types in math-lib.
 */

// ── Branded primitives ────────────────────────────────────────────────────────

/** Q64.96 fixed-point sqrt price, represented as a bigint. */
export type SqrtPriceX96 = bigint & { readonly __brand: 'SqrtPriceX96' };

/** Tick index, clamped to [MIN_TICK, MAX_TICK]. */
export type Tick = number & { readonly __brand: 'Tick' };

/** Liquidity amount (non-negative integer). */
export type Liquidity = bigint & { readonly __brand: 'Liquidity' };

/** Token amount (non-negative integer). */
export type TokenAmount = bigint & { readonly __brand: 'TokenAmount' };

// ── Constants ─────────────────────────────────────────────────────────────────

export const Q96: SqrtPriceX96 = (1n << 96n) as SqrtPriceX96;
export const MIN_TICK: Tick = -887272 as Tick;
export const MAX_TICK: Tick = 887272 as Tick;

// ── Error codes (mirrors MathError in lib.rs) ─────────────────────────────────

export const MathErrorCode = {
  InvalidTick: 1,
  PriceOutOfBounds: 2,
  Overflow: 3,
  Underflow: 4,
  DivisionByZero: 5,
} as const;

export type MathErrorCode = (typeof MathErrorCode)[keyof typeof MathErrorCode];

export class MathError extends Error {
  constructor(
    public readonly code: MathErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MathError';
  }
}

// ── Parameter / result shapes ─────────────────────────────────────────────────

export interface AmountDeltaParams {
  liquidity: Liquidity;
  sqrtPriceLowerX96: SqrtPriceX96;
  sqrtPriceUpperX96: SqrtPriceX96;
  sqrtPriceCurrentX96: SqrtPriceX96;
}

export interface AmountDeltaResult {
  amount0: TokenAmount;
  amount1: TokenAmount;
}

export interface NextSqrtPriceParams {
  sqrtPriceX96: SqrtPriceX96;
  liquidity: Liquidity;
  amountIn: TokenAmount;
  zeroForOne: boolean;
}

// ── Constructor helpers ───────────────────────────────────────────────────────

/** Cast a raw bigint to SqrtPriceX96 (validates > 0). */
export function toSqrtPriceX96(value: bigint): SqrtPriceX96 {
  if (value <= 0n)
    throw new MathError(MathErrorCode.PriceOutOfBounds, 'sqrtPriceX96 must be positive');
  return value as SqrtPriceX96;
}

/** Cast a raw number to Tick (validates bounds). */
export function toTick(value: number): Tick {
  if (!Number.isInteger(value) || value < MIN_TICK || value > MAX_TICK) {
    throw new MathError(
      MathErrorCode.InvalidTick,
      `tick ${value} out of [${MIN_TICK}, ${MAX_TICK}]`
    );
  }
  return value as Tick;
}

/** Cast a raw bigint to Liquidity (validates >= 0). */
export function toLiquidity(value: bigint): Liquidity {
  if (value < 0n) throw new MathError(MathErrorCode.Underflow, 'liquidity must be non-negative');
  return value as Liquidity;
}

/** Cast a raw bigint to TokenAmount (validates >= 0). */
export function toTokenAmount(value: bigint): TokenAmount {
  if (value < 0n) throw new MathError(MathErrorCode.Underflow, 'token amount must be non-negative');
  return value as TokenAmount;
}

// ── Empty-data handling ───────────────────────────────────────────────────────

/**
 * Discriminated union returned by safe math helpers.
 * Use `result.ok` to branch between the value and the human-readable message.
 *
 * @example
 * ```ts
 * const result = safeSqrtPriceX96(rawPrice);
 * if (!result.ok) {
 *   // Show result.message in the UI — it already explains the next step.
 *   return;
 * }
 * // result.value is a validated SqrtPriceX96
 * ```
 */
export type MathLibResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** User-facing messages for empty / invalid math-lib inputs. */
export const MATH_LIB_MESSAGES = {
  missingPrice: 'Price data is not available yet. Wait for the pool to initialise, then try again.',
  missingLiquidity: 'Liquidity data is missing. Refresh the page to reload pool state.',
  missingTick: 'Tick data is unavailable. Ensure the pool is active before proceeding.',
  missingAmount: 'Token amount is required. Enter a value greater than zero to continue.',
  invalidParams:
    'One or more calculation inputs are empty or invalid. Check your inputs and try again.',
} as const;

/**
 * Returns `true` when `value` is `null`, `undefined`, or (for bigint) `0n`.
 * Use this guard before passing data from the network/store to the math helpers.
 */
export function isEmpty(value: bigint | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'bigint') return value === 0n;
  return false;
}

/**
 * Safely wraps {@link toSqrtPriceX96}.
 * Returns a {@link MathLibResult} instead of throwing, so callers can display
 * the `.message` in the UI rather than catching exceptions.
 */
export function safeSqrtPriceX96(value: bigint | null | undefined): MathLibResult<SqrtPriceX96> {
  if (isEmpty(value)) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingPrice };
  }
  try {
    return { ok: true, value: toSqrtPriceX96(value as bigint) };
  } catch {
    return { ok: false, message: MATH_LIB_MESSAGES.missingPrice };
  }
}

/**
 * Safely wraps {@link toTick}.
 * Returns a {@link MathLibResult} instead of throwing.
 */
export function safeTick(value: number | null | undefined): MathLibResult<Tick> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingTick };
  }
  try {
    return { ok: true, value: toTick(value) };
  } catch {
    return { ok: false, message: MATH_LIB_MESSAGES.missingTick };
  }
}

/**
 * Safely wraps {@link toLiquidity}.
 * Returns a {@link MathLibResult} instead of throwing.
 */
export function safeLiquidity(value: bigint | null | undefined): MathLibResult<Liquidity> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingLiquidity };
  }
  try {
    return { ok: true, value: toLiquidity(value) };
  } catch {
    return { ok: false, message: MATH_LIB_MESSAGES.missingLiquidity };
  }
}

/**
 * Safely wraps {@link toTokenAmount}.
 * Returns a {@link MathLibResult} instead of throwing.
 */
export function safeTokenAmount(value: bigint | null | undefined): MathLibResult<TokenAmount> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingAmount };
  }
  try {
    return { ok: true, value: toTokenAmount(value) };
  } catch {
    return { ok: false, message: MATH_LIB_MESSAGES.missingAmount };
  }
}

/**
 * Validates all fields of an {@link AmountDeltaParams} object, returning a
 * {@link MathLibResult} with the fully-typed params or a descriptive message.
 *
 * Callers can spread the `.value` directly into the math function once the
 * result is confirmed ok.
 */
export function safeAmountDeltaParams(
  raw: Partial<Record<keyof AmountDeltaParams, bigint | null | undefined>>
): MathLibResult<AmountDeltaParams> {
  const liquidity = safeLiquidity(raw.liquidity ?? null);
  if (!liquidity.ok) return liquidity;

  const sqrtLower = safeSqrtPriceX96(raw.sqrtPriceLowerX96 ?? null);
  if (!sqrtLower.ok) return sqrtLower;

  const sqrtUpper = safeSqrtPriceX96(raw.sqrtPriceUpperX96 ?? null);
  if (!sqrtUpper.ok) return sqrtUpper;

  const sqrtCurrent = safeSqrtPriceX96(raw.sqrtPriceCurrentX96 ?? null);
  if (!sqrtCurrent.ok) return sqrtCurrent;

  return {
    ok: true,
    value: {
      liquidity: liquidity.value,
      sqrtPriceLowerX96: sqrtLower.value,
      sqrtPriceUpperX96: sqrtUpper.value,
      sqrtPriceCurrentX96: sqrtCurrent.value,
    },
  };
}
