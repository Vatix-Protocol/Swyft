export interface Token {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
}

export interface TokenPair {
  tokenIn: Token | null;
  tokenOut: Token | null;
}

export interface PositionSnapshot {
  id: string;
  ownerWallet: string;
  poolId: string;
  token0: string;
  token1: string;
  lowerTick: number;
  upperTick: number;
  liquidity: string;
  currentValueUsd: number;
  uncollectedFeesToken0: string;
  uncollectedFeesToken1: string;
  createdAt: number;
  closedAt: number | null;
  status: "active" | "closed";
  poolCurrentPrice: number;
}
