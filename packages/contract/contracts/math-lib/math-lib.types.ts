/**
 * Strict TypeScript types for the math-lib Soroban contract.
 *
 * These types mirror the Rust structs and enums in math-lib/src/lib.rs and
 * are used by the TypeScript integration layer (scripts, SDK, tests).
 *
 * Closes #204 — Improve TypeScript types in math-lib.
 *
 * ## Constructor contract
 *
 * Every branded primitive has exactly two constructors:
 *
 * - `toX(value)` — **throwing**. For trusted input that is already known to be
 *   present. Rejects invalid input with a {@link MathError} whose `code` is a
 *   {@link MathErrorCode}:
 *   - `toSqrtPriceX96`: `value <= 0n` → `PriceOutOfBounds`
 *   - `toTick`: non-integer or outside `[MIN_TICK, MAX_TICK]` → `InvalidTick`
 *   - `toLiquidity`: `value < 0n` → `Underflow`
 *   - `toTokenAmount`: `value < 0n` → `Underflow`
 *
 * - `safeToX(value)` — **non-throwing**. For untrusted or possibly-empty input
 *   (network responses, stores, form fields). Accepts `null` / `undefined` and
 *   never throws; returns a {@link MathLibResult}. It is `ok` exactly when the
 *   value is present and `toX(value)` would succeed; otherwise `message` is the
 *   helper's single {@link MATH_LIB_MESSAGES} entry (`missingPrice`,
 *   `missingTick`, `missingLiquidity`, `missingAmount` respectively).
 *
 * `MathLibResult` is produced only by the `safe*` helpers; the `to*` helpers
 * never return it.
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

/**
 * Cast a raw bigint to SqrtPriceX96.
 *
 * Any non-zero value is accepted, including prices below Q96 (i.e. prices
 * below 1.0), which are valid pool states. Only zero is rejected, matching
 * `sqrt_price_to_tick` in lib.rs which returns `PriceOutOfBounds` solely for
 * `sqrt_price_x96 == 0`.
 */
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
 * Discriminated union returned by the `safeTo*` helpers.
 * Use `result.ok` to branch between the value and the human-readable message.
 *
 * @example
 * ```ts
 * const result = safeToSqrtPriceX96(rawPrice);
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
 * Runs a throwing constructor, converting a {@link MathError} into a failed
 * {@link MathLibResult} carrying `message`.
 */
function attempt<T>(construct: () => T, message: string): MathLibResult<T> {
  try {
    return { ok: true, value: construct() };
  } catch (err) {
    // Match on `name` rather than `instanceof`: Error subclasses lose their
    // prototype when compiled to ES5.
    if ((err as Error | undefined)?.name === 'MathError') return { ok: false, message };
    throw err;
  }
}

/**
 * Non-throwing {@link toSqrtPriceX96}. Fails with
 * `MATH_LIB_MESSAGES.missingPrice` for `null`, `undefined`, `0n` or negatives.
 */
export function safeToSqrtPriceX96(
  value: bigint | null | undefined
): MathLibResult<SqrtPriceX96> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingPrice };
  }
  return attempt(() => toSqrtPriceX96(value), MATH_LIB_MESSAGES.missingPrice);
}

/**
 * Non-throwing {@link toTick}. Fails with `MATH_LIB_MESSAGES.missingTick` for
 * `null`, `undefined`, non-integers or values outside `[MIN_TICK, MAX_TICK]`.
 */
export function safeToTick(value: number | null | undefined): MathLibResult<Tick> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingTick };
  }
  return attempt(() => toTick(value), MATH_LIB_MESSAGES.missingTick);
}

/**
 * Non-throwing {@link toLiquidity}. Fails with
 * `MATH_LIB_MESSAGES.missingLiquidity` for `null`, `undefined` or negatives;
 * `0n` is valid.
 */
export function safeToLiquidity(value: bigint | null | undefined): MathLibResult<Liquidity> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingLiquidity };
  }
  return attempt(() => toLiquidity(value), MATH_LIB_MESSAGES.missingLiquidity);
}

/**
 * Non-throwing {@link toTokenAmount}. Fails with
 * `MATH_LIB_MESSAGES.missingAmount` for `null`, `undefined` or negatives;
 * `0n` is valid.
 */
export function safeToTokenAmount(
  value: bigint | null | undefined
): MathLibResult<TokenAmount> {
  if (value === null || value === undefined) {
    return { ok: false, message: MATH_LIB_MESSAGES.missingAmount };
  }
  return attempt(() => toTokenAmount(value), MATH_LIB_MESSAGES.missingAmount);
}

/** @deprecated Use {@link safeToSqrtPriceX96}. */
export const safeSqrtPriceX96 = safeToSqrtPriceX96;

/** @deprecated Use {@link safeToTick}. */
export const safeTick = safeToTick;

/** @deprecated Use {@link safeToLiquidity}. */
export const safeLiquidity = safeToLiquidity;

/** @deprecated Use {@link safeToTokenAmount}. */
export const safeTokenAmount = safeToTokenAmount;

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
  const liquidity = safeToLiquidity(raw.liquidity ?? null);
  if (!liquidity.ok) return liquidity;

  const sqrtLower = safeToSqrtPriceX96(raw.sqrtPriceLowerX96 ?? null);
  if (!sqrtLower.ok) return sqrtLower;

  const sqrtUpper = safeToSqrtPriceX96(raw.sqrtPriceUpperX96 ?? null);
  if (!sqrtUpper.ok) return sqrtUpper;

  const sqrtCurrent = safeToSqrtPriceX96(raw.sqrtPriceCurrentX96 ?? null);
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
