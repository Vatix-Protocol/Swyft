export type PositionStatus = 'active' | 'closed';
export type PositionStatusFilter = PositionStatus | 'all';
export type PositionRangeStatus = 'in-range' | 'out-of-range';

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
  status: PositionStatus;
  poolCurrentPrice: number;
}

export interface PositionsQuery {
  status: PositionStatusFilter;
  pool?: string;
  page: number;
  limit: number;
}

export interface PositionsListResult {
  items: PositionSnapshot[];
  total: number;
}
