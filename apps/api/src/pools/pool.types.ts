export type PoolOrderBy = 'tvl' | 'volume' | 'apr';

export interface PoolSnapshot {
  id: string;
  token0: string;
  token1: string;
  feeTier: string;
  tvl: number;
  volume24h: number;
  feeApr: number;
  currentPrice: number;
  active: boolean;
  updatedAt: number;
}

export interface PoolListQuery {
  page: number;
  limit: number;
  orderBy: PoolOrderBy;
  search?: string;
}

export interface PoolListResult {
  items: PoolSnapshot[];
  total: number;
}

export interface TickData {
  tickIndex: number;
  liquidityNet: string;
  liquidityGross: string;
  feeGrowthOutside0X128: string;
  feeGrowthOutside1X128: string;
}

export interface GetTicksQuery {
  poolId: string;
  lowerTick?: number;
  upperTick?: number;
}

/**
 * Stable error codes for LP mint/burn liquidity position operations.
 * Deny-by-default: unknown/unauthorized callers map to LP_UNAUTHORIZED.
 */
export type LiquidityErrorCode =
  | 'LP_UNAUTHORIZED'
  | 'LP_INVALID_AMOUNT'
  | 'LP_INVALID_TICK_RANGE'
  | 'LP_POOL_NOT_FOUND'
  | 'LP_POOL_INACTIVE'
  | 'LP_INSUFFICIENT_LIQUIDITY'
  | 'LP_DEPENDENCY_UNAVAILABLE'
  | 'LP_REPLAY_DETECTED';

/**
 * Roles permitted to mutate liquidity positions. Deny-by-default: any role
 * not listed here (including unauthenticated clients) is rejected.
 */
export type LiquidityRole = 'lp' | 'admin';

/**
 * Authenticated principal for a mint/burn request. `role` is resolved
 * server-side; clients cannot self-assert it.
 */
export interface LiquidityPrincipal {
  subject: string;
  role: LiquidityRole;
  /** Optional expiry (epoch ms); expired principals are rejected. */
  expiresAt?: number;
}

/**
 * Mint liquidity into a position. `idempotencyKey` makes concurrent/replayed
 * requests safe: the same key must not double-apply liquidity.
 */
export interface MintLiquidityRequest {
  poolId: string;
  lowerTick: number;
  upperTick: number;
  /** Desired liquidity amount as a decimal string (base units). */
  amount: string;
  /** Client-supplied idempotency key; required for replay safety. */
  idempotencyKey: string;
  /** Correlation id propagated through logs/metrics (no secrets). */
  correlationId?: string;
}

/**
 * Burn liquidity from a position. `idempotencyKey` makes concurrent/replayed
 * requests safe: the same key must not double-apply the burn.
 */
export interface BurnLiquidityRequest {
  poolId: string;
  lowerTick: number;
  upperTick: number;
  /** Liquidity amount to remove as a decimal string (base units). */
  amount: string;
  idempotencyKey: string;
  correlationId?: string;
}

/**
 * Result of a mint/burn. `applied` is false when the request was a replay of
 * an already-processed idempotency key (no state change).
 */
export interface LiquidityPositionResult {
  poolId: string;
  lowerTick: number;
  upperTick: number;
  /** Resulting position liquidity after the operation (base units). */
  liquidity: string;
  /** Amount of token0 accounted for by the operation (base units). */
  amount0: string;
  /** Amount of token1 accounted for by the operation (base units). */
  amount1: string;
  applied: boolean;
  correlationId: string;
}

/**
 * Typed error surfaced by mint/burn entrypoints. Carries a stable code so
 * callers can branch without parsing messages.
 */
export interface LiquidityError {
  code: LiquidityErrorCode;
  message: string;
  correlationId: string;
}
