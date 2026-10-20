export enum SwapErrorCode {
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  UNKNOWN_TOKEN = 'UNKNOWN_TOKEN',
}

export interface SwapSnapshot {
  id: string;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  /** Fee charged for this swap (expressed in token0 units). */
  feeAmount: string;
  /** Ordered pool IDs the swap routed through, when known (e.g. multi-hop). */
  route?: string[];
  txHash: string;
  walletAddress: string;
  timestamp: number;
}

export interface SwapsQuery {
  poolId?: string;
  wallet?: string;
  page: number;
  limit: number;
}

export interface SwapsListResult {
  items: SwapSnapshot[];
  total: number;
}

/**
 * Inclusive bounds for a caller-supplied slippage tolerance, in basis points
 * (1 bps = 0.01%). 5000 bps (50%) matches the cap enforced by the web swap
 * settings; anything above it offers no meaningful price protection.
 */
export const SLIPPAGE_BPS_MIN = 0;
export const SLIPPAGE_BPS_MAX = 5000;
/** Slippage tolerance applied when the caller omits one: 50 bps (0.5%). */
export const SLIPPAGE_BPS_DEFAULT = 50;

/** Response shape for GET /swaps/quote. */
export interface SwapQuoteResult {
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  amountOut: string;
  executionPrice: string;
  /**
   * Minimum amount of tokenOut (decimal string, tokenOut units) accepted
   * after applying `slippageBps`: `amountOut * (10000 - slippageBps) / 10000`.
   */
  minimumReceived: string;
  /**
   * Estimated price impact as a percentage in the range 0–100 (e.g. `0.25`
   * means 0.25%), not a 0–1 fraction. Never negative.
   */
  priceImpact: number;
  poolId: string | null;
  /**
   * Slippage tolerance in basis points (1 bps = 0.01%), an integer within
   * [SLIPPAGE_BPS_MIN, SLIPPAGE_BPS_MAX].
   */
  slippageBps: number;
}
