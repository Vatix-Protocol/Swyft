export interface PoolState {
  poolAddress: string;
  sqrtPrice: string;
  currentTick: number;
  liquidity: string;
  feeTier: number;
  token0: string;
  token1: string;
}

export interface PositionState {
  positionNftId: string;
  owner: string;
  pool: string;
  lowerTick: number;
  upperTick: number;
  liquidity: string;
}

export interface TickState {
  tick: number;
  liquidityNet: string;
  liquidityGross: string;
  feeGrowthOutside: string;
}

export class SwyftRpcError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SwyftRpcError';
  }
}
