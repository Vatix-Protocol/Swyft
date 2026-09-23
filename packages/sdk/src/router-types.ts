/**
 * Soroban router contract type signatures for TypeScript SDK.
 *
 * These types mirror the router contract's Rust definitions:
 * packages/contract/contracts/router/src/lib.rs
 *
 * The router contract enforces deadline and slippage protections,
 * making it the only safe entrypoint for production swaps.
 */

import type { StellarAddress, RawAmount } from './swap';

/**
 * Parameters for an exact-input single-hop swap through the router.
 *
 * This struct is passed to the router.exact_input_single contract method.
 * The router validates the deadline and slippage (via amount_out_min)
 * before executing the swap.
 *
 * @remarks
 * - `amount_in` must be > 0, else the router panics with ZeroAmount.
 * - `deadline` must be in the future, else the router panics with DeadlineExpired.
 * - `amount_out` must be >= `amount_out_min`, else the router panics with SlippageExceeded.
 * - The swap is only published as an event if the slippage check passes.
 */
export interface ExactInputSingleParams {
  /** Address of the token being sold. */
  readonly tokenIn: StellarAddress;
  /** Address of the token being bought. */
  readonly tokenOut: StellarAddress;
  /** Pool fee tier to route through (e.g., 3000 for 0.3%). */
  readonly fee: number;
  /** Address that receives the output tokens. */
  readonly recipient: StellarAddress;
  /** Unix timestamp (seconds) after which the swap must no longer execute. */
  readonly deadline: number;
  /** Exact amount of input tokens to swap. Must be > 0. */
  readonly amountIn: RawAmount;
  /** Minimum acceptable output amount (inclusive boundary). */
  readonly amountOutMin: RawAmount;
  /** Price limit for the swap (0 to disable). */
  readonly sqrtPriceLimitX96: RawAmount;
}

/**
 * Result of a swap executed via the router.
 *
 * This struct is returned by router.exact_input_single and router.exact_output_single.
 */
export interface SwapResult {
  /** Actual amount of input tokens consumed. */
  readonly amountIn: RawAmount;
  /** Actual amount of output tokens received. */
  readonly amountOut: RawAmount;
}

/**
 * Router contract errors (mirrored from Rust).
 * These errors are returned as contract panics.
 */
export enum RouterError {
  NotInitialized = 1,
  DeadlineExpired = 2,
  SlippageExceeded = 3,
  ZeroAmount = 4,
  PoolNotFound = 5,
  EmptyData = 6,
  AlreadyInitialized = 7,
}
