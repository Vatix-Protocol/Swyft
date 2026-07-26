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

/** Response shape for GET /swaps/quote. */
export interface SwapQuoteResult {
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  amountOut: string;
  executionPrice: string;
  minimumReceived: string;
  priceImpact: number;
  poolId: string | null;
  slippageBps: number;
}
