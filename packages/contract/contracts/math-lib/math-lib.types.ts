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
export type SqrtPriceX96 = bigint & { readonly __brand: "SqrtPriceX96" };

/** Tick index, clamped to [MIN_TICK, MAX_TICK]. */
export type Tick = number & { readonly __brand: "Tick" };

/** Liquidity amount (non-negative integer). */
export type Liquidity = bigint & { readonly __brand: "Liquidity" };

/** Token amount (non-negative integer). */
export type TokenAmount = bigint & { readonly __brand: "TokenAmount" };

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
    message: string,
  ) {
    super(message);
    this.name = "MathError";
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
  if (value <= 0n) throw new MathError(MathErrorCode.PriceOutOfBounds, "sqrtPriceX96 must be positive");
  return value as SqrtPriceX96;
}

/** Cast a raw number to Tick (validates bounds). */
export function toTick(value: number): Tick {
  if (!Number.isInteger(value) || value < MIN_TICK || value > MAX_TICK) {
    throw new MathError(MathErrorCode.InvalidTick, `tick ${value} out of [${MIN_TICK}, ${MAX_TICK}]`);
  }
  return value as Tick;
}

/** Cast a raw bigint to Liquidity (validates >= 0). */
export function toLiquidity(value: bigint): Liquidity {
  if (value < 0n) throw new MathError(MathErrorCode.Underflow, "liquidity must be non-negative");
  return value as Liquidity;
}

/** Cast a raw bigint to TokenAmount (validates >= 0). */
export function toTokenAmount(value: bigint): TokenAmount {
  if (value < 0n) throw new MathError(MathErrorCode.Underflow, "token amount must be non-negative");
  return value as TokenAmount;
}
