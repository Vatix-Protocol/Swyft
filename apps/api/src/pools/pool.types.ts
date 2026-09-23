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
 * Single source of truth (SoT) for pool state is the `pool` crate record
 * (see CONTRACTS.md). Concentrated-liquidity (cl-pool) data is a *derived
 * view* over that record and MUST NOT be treated as an independent authority
 * for liquidity, swaps, or settlement. The types below make that derivation
 * explicit so consumers cannot accidentally read cl-pool as a parallel SoT.
 */
export type PoolSourceOfTruth = 'pool';

/**
 * Provenance marker attached to every cl-pool derived value. `source` is
 * always 'pool' (the authoritative record); `derived` is always true so
 * callers can assert they are not reading a parallel authority.
 */
export interface ClPoolDerivation {
  source: PoolSourceOfTruth;
  derived: true;
  /** Pool record id this cl-pool view was derived from. */
  poolId: string;
  /** Epoch ms the derivation was computed from the pool SoT. */
  derivedAt: number;
}

/**
 * cl-pool view of a pool's concentrated-liquidity state. All fields are
 * derived from the pool SoT record; there is no independent cl-pool store.
 */
export interface ClPoolView extends ClPoolDerivation {
  /** Current sqrt price (X96) as a decimal string, derived from pool SoT. */
  sqrtPriceX96: string;
  /** Current tick index, derived from pool SoT. */
  tick: number;
  /** Active liquidity, derived from pool SoT. */
  liquidity: string;
  /** Tick spacing configured on the pool SoT record. */
  tickSpacing: number;
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
