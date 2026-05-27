/** Represents a single tradeable token */
export interface Token {
  /** Unique identifier — typically the on-chain asset address or symbol */
  id: string;
  /** Short display symbol, e.g. "XLM" or "USDC" */
  symbol: string;
  /** Full human-readable name, e.g. "Stellar Lumens" */
  name: string;
  /** URL of the token logo image, or null if unavailable */
  logoUrl: string | null;
}

/** A directional pair of tokens used in swap and liquidity flows */
export interface TokenPair {
  /** The token being sold / provided as input; null when not yet selected */
  tokenIn: Token | null;
  /** The token being bought / received as output; null when not yet selected */
  tokenOut: Token | null;
}

/** A snapshot of a liquidity position at a point in time */
export interface PositionSnapshot {
  /** Unique position identifier */
  id: string;
  /** Wallet address that owns this position */
  ownerWallet: string;
  /** ID of the pool this position belongs to */
  poolId: string;
  /** On-chain identifier of token0 in the pool */
  token0: string;
  /** On-chain identifier of token1 in the pool */
  token1: string;
  /** Lower tick boundary of the concentrated liquidity range */
  lowerTick: number;
  /** Upper tick boundary of the concentrated liquidity range */
  upperTick: number;
  /** Raw liquidity amount as a string to preserve precision */
  liquidity: string;
  /** Current USD value of the position including uncollected fees */
  currentValueUsd: number;
  /** Uncollected fees denominated in token0, as a string */
  uncollectedFeesToken0: string;
  /** Uncollected fees denominated in token1, as a string */
  uncollectedFeesToken1: string;
  /** Unix timestamp (seconds) when the position was opened */
  createdAt: number;
  /** Unix timestamp (seconds) when the position was closed, or null if still active */
  closedAt: number | null;
  /** Whether the position is currently earning fees */
  status: "active" | "closed";
  /** Current price of the pool, used to determine if the position is in range */
  poolCurrentPrice: number;
}
