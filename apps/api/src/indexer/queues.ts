import { Queue, QueueOptions } from 'bullmq';

export const QUEUE_NAMES = {
  POOL_CREATED: 'pool.created',
  SWAP_PROCESSED: 'swap.processed',
  POSITION_MINTED: 'position.minted',
  POSITION_BURNED: 'position.burned',
  FEES_COLLECTED: 'fees.collected',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Metadata shared by all events emitted by the ledger indexer. `ledger` is
 * optional while upstream producers are rolled out; events without it are
 * still persisted, but cannot advance the recovery checkpoint.
 */
export interface IndexerJobData {
  eventId: string;
  ledger?: number;
}

export interface PoolCreatedJobData extends IndexerJobData {
  poolId: string;
  tokenA: string;
  tokenB: string;
  fee: string;
  sqrtPriceX96: string;
}

export interface SwapProcessedJobData extends IndexerJobData {
  poolId: string;
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: number;
  /** Transaction hash when Horizon exposes one; falls back to eventId. */
  transactionHash?: string;
  /** ISO-8601 timestamp emitted by Horizon. */
  timestamp?: string;
}

export interface PositionMintedJobData extends IndexerJobData {
  poolId: string;
  /** Pool-local NFT/position identifier. */
  tokenId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
}

export interface PositionBurnedJobData extends IndexerJobData {
  poolId: string;
  /** Pool-local NFT/position identifier. */
  tokenId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
}

export interface FeesCollectedJobData extends IndexerJobData {
  poolId: string;
  recipient: string;
  amount0: string;
  amount1: string;
}

export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  // A worker may be restarted after writing to Postgres but before BullMQ can
  // acknowledge the job. Keep failed jobs and rely on eventId upserts so the
  // recovered job is safe to execute again.
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
