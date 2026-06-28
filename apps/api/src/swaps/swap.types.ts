export enum SwapErrorCode {
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
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
  pool?: string;
  wallet?: string;
  page: number;
  limit: number;
}

export interface SwapsListResult {
  items: SwapSnapshot[];
  total: number;
}
