/**
 * Raw contract response object structure for pool state queries.
 */
interface RawPoolStateResponse {
  [key: string]: unknown;
}

/**
 * Raw contract response object structure for position queries.
 */
interface RawPositionResponse {
  [key: string]: unknown;
}

/**
 * Raw contract response object structure for tick queries.
 */
interface RawTickResponse {
  [key: string]: unknown;
}

/**
 * Represents the complete state of a liquidity pool.
 * All numeric values are represented as strings to preserve precision.
 */
export interface PoolState {
  readonly poolAddress: string;
  readonly sqrtPrice: string;
  readonly currentTick: number;
  readonly liquidity: string;
  readonly feeTier: number;
  readonly token0: string;
  readonly token1: string;
}

/**
 * Represents the complete state of a concentrated liquidity position (NFT).
 * All numeric values are represented as strings to preserve precision.
 */
export interface PositionState {
  readonly positionNftId: string;
  readonly owner: string;
  readonly pool: string;
  readonly lowerTick: number;
  readonly upperTick: number;
  readonly liquidity: string;
}

/**
 * Represents the state of a specific tick in a liquidity pool.
 * All numeric values are represented as strings to preserve precision.
 */
export interface TickState {
  readonly tick: number;
  readonly liquidityNet: string;
  readonly liquidityGross: string;
  readonly feeGrowthOutside: string;
}

/**
 * Custom error class for Swyft RPC operations.
 * Provides context about what operation failed and the underlying cause.
 */
export class SwyftRpcError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'SwyftRpcError';
    Object.setPrototypeOf(this, SwyftRpcError.prototype);
  }
}
