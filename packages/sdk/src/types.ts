export interface PoolState {
  readonly poolAddress: string;
  readonly sqrtPrice: string;
  readonly currentTick: number;
  readonly liquidity: string;
  readonly feeTier: number;
  readonly token0: string;
  readonly token1: string;
}

export interface PositionState {
  readonly positionNftId: string;
  readonly owner: string;
  readonly pool: string;
  readonly lowerTick: number;
  readonly upperTick: number;
  readonly liquidity: string;
}

export interface TickState {
  readonly tick: number;
  readonly liquidityNet: string;
  readonly liquidityGross: string;
  readonly feeGrowthOutside: string;
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
