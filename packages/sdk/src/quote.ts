import { PoolState, TickState } from './types';

const Q96 = 79228162514264337593543950336n; // 2^96
const MAX_TICK = 887272;
const MIN_TICK = -887272;

/** Thrown when a quote helper receives a zero or negative amount. */
export class QuoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteValidationError';
  }
}

/**
 * Parameters for calculating a simple swap quote without pool state.
 * Used for quick estimates before fetching full pool data.
 */
export interface SwapQuoteParams {
  readonly poolId: string;
  readonly tokenInId: string;
  readonly tokenOutId: string;
  readonly amountIn: string;
  readonly slippageBps: number;
}

/**
 * Quote result from a swap operation.
 * All amounts are strings to preserve precision.
 */
export interface SwapQuote {
  readonly amountOut: string;
  readonly priceImpact: number;
  readonly lpFee: string;
  readonly protocolFee: string;
  readonly minimumReceived: string;
  readonly executionPrice: string;
}

/** Pool state extended with optional tick ladder for local simulation. */
export type PoolStateWithTicks = PoolState & { readonly ticks?: readonly TickState[] };

export interface LocalSwapQuoteParams {
  readonly poolState: PoolStateWithTicks;
  readonly tokenIn: string;
  readonly amountIn: string | bigint;
  /** Slippage tolerance in basis points (0–10000). */
  readonly slippage: number;
}

export interface LocalSwapQuote {
  readonly amountOut: string;
  readonly priceImpact: number;
  readonly fee: string;
  readonly minimumReceived: string;
  readonly sqrtPriceLimitX96: string;
}

/** Intermediate result of a single tick-crossing swap step. */
interface SwapStepResult {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly nextSqrtPrice: bigint;
  readonly reachedTarget: boolean;
}

/**
 * A zero-value quote returned when inputs are missing or invalid.
 * Use as a fallback when swap parameters are invalid.
 */
export const EMPTY_QUOTE: SwapQuote = {
  amountOut: '0',
  priceImpact: 0,
  lpFee: '0',
  protocolFee: '0',
  minimumReceived: '0',
  executionPrice: '0',
};

/**
 * Determine if a quote represents an empty or invalid result.
 * @param quote - The quote to check
 * @returns true if the quote is empty (zero output), false otherwise
 */
export function isEmptyQuote(quote: SwapQuote): boolean {
  return quote.amountOut === '0' && quote.executionPrice === '0';
}

/**
 * Validates the slippage tolerance (in basis points) shared by the local
 * quote helpers. Throws {@link QuoteValidationError} when the value is not a
 * finite number within the inclusive `[0, 10000]` bps range.
 */
function validateSlippage(slippage: number): void {
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 10000) {
    throw new QuoteValidationError('slippage must be between 0 and 10000 basis points');
  }
}

/**
 * Validates a pool fee tier. Throws {@link QuoteValidationError} when the
 * value is not a positive integer.
 */
function validateFeeTier(feeTier: number): void {
  if (!Number.isInteger(feeTier) || feeTier <= 0) {
    throw new QuoteValidationError('feeTier must be a positive integer');
  }
}

/**
 * Calculates a local swap quote.
 *
 * @param params - Quote inputs for the swap.
 * @returns A swap quote including output amount, price impact, fees, and minimum received.
 */
export function calculateSwapQuote(params: SwapQuoteParams): SwapQuote {
  if (
    !params ||
    !params.amountIn ||
    params.amountIn.trim().length === 0 ||
    !params.tokenInId ||
    !params.tokenOutId
  ) {
    return EMPTY_QUOTE;
  }

  validateSlippage(params.slippageBps);

  const amountIn = parseFloat(params.amountIn);

  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new QuoteValidationError('amountIn must be greater than zero');
  }
  const reserveIn = 1_000_000;
  const reserveOut = 1_000_000;
  const lpFeeBps = 30;
  const lpFeeAmt = amountIn * (lpFeeBps / 10_000);
  const amountInAfterFee = amountIn - lpFeeAmt;
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const executionPrice = amountOut / amountIn;
  const priceImpactPct = Math.max(0, ((spotPrice - executionPrice) / spotPrice) * 100);
  const minimumReceived = amountOut * (1 - params.slippageBps / 10_000);
  return {
    amountOut: amountOut.toFixed(7),
    priceImpact: parseFloat(priceImpactPct.toFixed(4)),
    lpFee: lpFeeAmt.toFixed(7),
    protocolFee: '0',
    minimumReceived: minimumReceived.toFixed(7),
    executionPrice: executionPrice.toFixed(7),
  };
}

/**
 * Parameters for calculating a simple exact-output quote without pool
 * state — the inverse of {@link SwapQuoteParams}: the caller specifies the
 * desired output amount and this returns the required input amount (plus
 * a maximum input, inflated by the slippage tolerance).
 */
export interface ExactOutputQuoteParams {
  readonly poolId: string;
  readonly tokenInId: string;
  readonly tokenOutId: string;
  readonly amountOut: string;
  readonly slippageBps: number;
}

/** Quote result for an exact-output swap. All amounts are strings to preserve precision. */
export interface ExactOutputQuote {
  readonly amountIn: string;
  readonly maximumIn: string;
  readonly priceImpact: number;
  readonly lpFee: string;
  readonly protocolFee: string;
  readonly executionPrice: string;
}

/** A zero-value exact-output quote for missing/invalid inputs. */
export const EMPTY_EXACT_OUTPUT_QUOTE: ExactOutputQuote = {
  amountIn: '0',
  maximumIn: '0',
  priceImpact: 0,
  lpFee: '0',
  protocolFee: '0',
  executionPrice: '0',
};

/**
 * Calculates a local exact-output swap quote using the same constant-product
 * approximation as {@link calculateSwapQuote}, solved for the required input
 * given a desired output amount.
 *
 * @param params - Quote inputs for the exact-output swap.
 * @returns A quote including required input, price impact, fees, and a
 *   maximum input inflated by the slippage tolerance.
 */
export function calculateExactOutputQuote(params: ExactOutputQuoteParams): ExactOutputQuote {
  if (
    !params ||
    !params.amountOut ||
    params.amountOut.trim().length === 0 ||
    !params.tokenInId ||
    !params.tokenOutId
  ) {
    return EMPTY_EXACT_OUTPUT_QUOTE;
  }

  validateSlippage(params.slippageBps);

  const amountOut = parseFloat(params.amountOut);
  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    throw new QuoteValidationError('amountOut must be greater than zero');
  }

  const reserveIn = 1_000_000;
  const reserveOut = 1_000_000;
  const lpFeeBps = 30;

  if (amountOut >= reserveOut) {
    throw new QuoteValidationError('amountOut exceeds available liquidity');
  }

  // Inverse of the constant-product formula used in calculateSwapQuote:
  // amountInAfterFee = reserveIn * amountOut / (reserveOut - amountOut)
  const amountInAfterFee = (reserveIn * amountOut) / (reserveOut - amountOut);
  const amountIn = amountInAfterFee / (1 - lpFeeBps / 10_000);
  const lpFeeAmt = amountIn - amountInAfterFee;

  const spotPrice = reserveOut / reserveIn;
  const executionPrice = amountOut / amountIn;
  const priceImpactPct = Math.max(0, ((spotPrice - executionPrice) / spotPrice) * 100);
  const maximumIn = amountIn * (1 + params.slippageBps / 10_000);

  return {
    amountIn: amountIn.toFixed(7),
    maximumIn: maximumIn.toFixed(7),
    priceImpact: parseFloat(priceImpactPct.toFixed(4)),
    lpFee: lpFeeAmt.toFixed(7),
    protocolFee: '0',
    executionPrice: executionPrice.toFixed(7),
  };
}

export function getSwapQuote(params: LocalSwapQuoteParams): LocalSwapQuote {
  validateSlippage(params.slippage);
  validateFeeTier(params.poolState.feeTier);

  const amountIn = toBigIntAmount(params.amountIn);
  if (amountIn <= 0n) {
    throw new QuoteValidationError('amountIn must be greater than zero');
  }

  const zeroForOne = direction(params.poolState, params.tokenIn);
  let sqrtPrice = BigInt(params.poolState.sqrtPriceX96);
  const liquidity = BigInt(params.poolState.liquidity);

  if (liquidity <= 0n) {
    throw new QuoteValidationError('zero liquidity');
  }

  const feeTier = params.poolState.feeTier;
  const feeAmount = (amountIn * BigInt(feeTier)) / 1_000_000n;
  const amountInAfterFee = amountIn - feeAmount;

  let remainingIn = amountInAfterFee;
  let totalOut = 0n;
  let crossedTicks = 0;

  const ticks = params.poolState.ticks ?? [];
  const sortedTicks = [...ticks].sort((a, b) =>
    zeroForOne ? b.tick - a.tick : a.tick - b.tick,
  );

  for (const tick of sortedTicks) {
    if (remainingIn <= 0n) break;
    const targetSqrtPrice = BigInt(tick.sqrtPriceX96);
    const step = computeSwapStep(
      sqrtPrice,
      targetSqrtPrice,
      liquidity,
      remainingIn,
      zeroForOne,
    );
    totalOut += step.amountOut;
    remainingIn -= step.amountIn;
    sqrtPrice = step.nextSqrtPrice;
    if (step.reachedTarget) {
      crossedTicks += 1;
    } else {
      break;
    }
  }

  if (remainingIn > 0n) {
    throw new QuoteValidationError('amount exceeds available liquidity');
  }

  if (totalOut <= 0n) {
    throw new QuoteValidationError('zero liquidity');
  }

  const amountOut = totalOut;
  const executionPrice = Number(amountOut) / Number(amountIn);
  const spotPrice = Number(Q96) / Number(sqrtPrice);
  const priceImpactPct = Math.max(0, ((spotPrice - executionPrice) / spotPrice) * 100);
  const minimumReceived = (amountOut * BigInt(10_000 - params.slippage)) / 10_000n;

  return {
    amountOut: amountOut.toString(),
    priceImpact: parseFloat(priceImpactPct.toFixed(4)),
    fee: feeAmount.toString(),
    minimumReceived: minimumReceived.toString(),
    sqrtPriceLimitX96: sqrtPrice.toString(),
  };
}

/**
 * Resolves the swap direction from the pool state and the input token.
 * Throws {@link QuoteValidationError} when the token does not match either
 * side of the pool.
 */
function direction(poolState: PoolState, tokenIn: string): boolean {
  if (tokenIn === poolState.token0) return true;
  if (tokenIn === poolState.token1) return false;
  throw new QuoteValidationError('invalid token direction');
}

/** Parses a string or bigint amount into a bigint, defaulting to 0n. */
function toBigIntAmount(amount: string | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  try {
    return BigInt(amount);
  } catch {
    return 0n;
  }
}

/**
 * Computes a single swap step against a target sqrt price, mirroring the
 * Uniswap v3 `computeSwapStep` helper. Returns the input consumed, output
 * produced, the next sqrt price, and whether the target was reached.
 */
function computeSwapStep(
  sqrtPriceCurrent: bigint,
  sqrtPriceTarget: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  zeroForOne: boolean,
): SwapStepResult {
  const sqrtPriceNext = zeroForOne
    ? sqrtPriceTarget < sqrtPriceCurrent
      ? sqrtPriceTarget
      : sqrtPriceCurrent
    : sqrtPriceTarget > sqrtPriceCurrent
      ? sqrtPriceTarget
      : sqrtPriceCurrent;

  const reachedTarget = sqrtPriceNext === sqrtPriceTarget;

  const amountIn = zeroForOne
    ? (liquidity * (sqrtPriceCurrent - sqrtPriceNext)) / sqrtPriceCurrent
    : (liquidity * (sqrtPriceNext - sqrtPriceCurrent)) / sqrtPriceNext;

  const amountOut = zeroForOne
    ? (liquidity * (sqrtPriceCurrent - sqrtPriceNext)) / sqrtPriceNext
    : (liquidity * (sqrtPriceNext - sqrtPriceCurrent)) / sqrtPriceCurrent;

  if (amountIn > amountRemaining) {
    return {
      amountIn: amountRemaining,
      amountOut: (amountOut * amountRemaining) / amountIn,
      nextSqrtPrice: sqrtPriceCurrent,
      reachedTarget: false,
    };
  }

  return { amountIn, amountOut, nextSqrtPrice: sqrtPriceNext, reachedTarget };
}
