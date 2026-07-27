/**
 * Status of a liquidity position.
 * - `active`: Position is currently open and earning fees
 * - `closed`: Position has been closed by the owner
 */
export type PositionStatus = 'active' | 'closed';

/**
 * Filter option for position status queries.
 * Extends PositionStatus with 'all' to retrieve all positions regardless of status.
 */
export type PositionStatusFilter = PositionStatus | 'all';

/**
 * Range status of a position relative to the current pool price.
 * - `in-range`: Position price range includes the current pool price
 * - `out-of-range`: Position price range does not include the current pool price
 */
export type PositionRangeStatus = 'in-range' | 'out-of-range';

/**
 * Snapshot of a liquidity position at a point in time.
 * Contains all position metadata and current valuation.
 */
export interface PositionSnapshot {
  /** Unique identifier for the position */
  readonly id: string;
  /** Wallet address of the position owner */
  readonly ownerWallet: string;
  /** Pool identifier where the position is deployed */
  readonly poolId: string;
  /** NFT token ID identifying this position on-chain */
  readonly tokenId: string;
  /** First token in the trading pair */
  readonly token0: string;
  /** Second token in the trading pair */
  readonly token1: string;
  /** Lower tick boundary (represented as integer) */
  readonly lowerTick: number;
  /** Upper tick boundary (represented as integer) */
  readonly upperTick: number;
  /** Total liquidity in the position (represented as string to preserve precision) */
  readonly liquidity: string;
  /** Current USD valuation of the position */
  readonly currentValueUsd: number;
  /** Uncollected fees in token0 (represented as string to preserve precision) */
  readonly uncollectedFeesToken0: string;
  /** Uncollected fees in token1 (represented as string to preserve precision) */
  readonly uncollectedFeesToken1: string;
  /** Unix timestamp when the position was created */
  readonly createdAt: number;
  /** Unix timestamp when the position was closed, or null if still active */
  readonly closedAt: number | null;
  /** Current status of the position */
  readonly status: PositionStatus;
  /** Current price of the pool (in terms of token1 per token0) */
  readonly poolCurrentPrice: number;
}

/**
 * Query parameters for fetching positions.
 * Used to filter, paginate, and sort position results.
 */
export interface PositionsQuery {
  /** Filter by position status */
  readonly status: PositionStatusFilter;
  /** Filter by pool ID (optional) */
  readonly pool?: string;
  /** Page number for pagination (1-based indexing) */
  readonly page: number;
  /** Number of results per page */
  readonly limit: number;
}

/**
 * Result of a positions list query.
 * Contains paginated position snapshots and total count.
 */
export interface PositionsListResult {
  /** Array of position snapshots matching the query */
  readonly items: PositionSnapshot[];
  /** Total number of positions matching the query (across all pages) */
  readonly total: number;
}
