import { Queue, QueueOptions } from 'bullmq';

export const QUEUE_NAMES = {
  POOL_CREATED: 'pool.created',
  SWAP_PROCESSED: 'swap.processed',
  POSITION_MINTED: 'position.minted',
  POSITION_BURNED: 'position.burned',
  FEES_COLLECTED: 'fees.collected',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PoolCreatedJobData {
  eventId: string;
  poolId: string;
  tokenA: string;
  tokenB: string;
  fee: string;
  sqrtPriceX96: string;
}

export interface SwapProcessedJobData {
  eventId: string;
  poolId: string;
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: number;
}

export interface PositionMintedJobData {
  eventId: string;
  poolId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
}

export interface PositionBurnedJobData {
  eventId: string;
  poolId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
}

export interface FeesCollectedJobData {
  eventId: string;
  poolId: string;
  recipient: string;
  amount0: string;
  amount1: string;
}

export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

export function makeQueueOptions(): QueueOptions {
  return {
    connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    defaultJobOptions,
  };
}

export function createQueue(name: QueueName): Queue {
  return new Queue(name, makeQueueOptions());
}
