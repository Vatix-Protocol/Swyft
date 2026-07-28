import { Queue, QueueOptions } from 'bullmq';

export const QUEUE_NAMES = {
  POOL_CREATED: 'pool.created',
  SWAP_PROCESSED: 'swap.processed',
  POSITION_MINTED: 'position.minted',
  POSITION_BURNED: 'position.burned',
  FEES_COLLECTED: 'fees.collected',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Kept out of QUEUE_NAMES because IndexerWorker iterates
// `Object.values(QUEUE_NAMES)` to attach its DLQ-logging QueueEvents
// listeners — the candle queue has its own worker/listeners (see
// candles.processor.ts) and must not be picked up by that loop.
export const CANDLES_QUEUE_NAME = 'candle-aggregation' as const;

// DI tokens for each queue's BullMQ Queue provider. Defined here (rather
// than in indexer.module.ts) so indexer-replay.service.ts can import them
// without a module -> service -> module circular import.
export const QUEUE_POOL_CREATED = 'QUEUE_POOL_CREATED';
export const QUEUE_SWAP_PROCESSED = 'QUEUE_SWAP_PROCESSED';
export const QUEUE_POSITION_MINTED = 'QUEUE_POSITION_MINTED';
export const QUEUE_POSITION_BURNED = 'QUEUE_POSITION_BURNED';
export const QUEUE_FEES_COLLECTED = 'QUEUE_FEES_COLLECTED';

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
  /** ISO-8601 timestamp from Horizon ledger close time. */
  timestamp?: string;
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
  /** Fee amount parsed directly from the on-chain event, when available. */
  feeAmount?: string;
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

const DEFAULT_WORKER_CONCURRENCY = 5;

/**
 * Per-queue BullMQ worker concurrency. Each event type is an independent,
 * idempotent projection, so jobs of the same type can safely run in parallel
 * within a worker process. Overridable per queue via
 * `INDEXER_CONCURRENCY_<QUEUE_NAME>` (queue name upper-cased, dots to
 * underscores), falling back to `INDEXER_CONCURRENCY` and finally the default.
 */
export function getWorkerConcurrency(queueName: QueueName): number {
  const envKey = `INDEXER_CONCURRENCY_${queueName.toUpperCase().replace(/\./g, '_')}`;
  const raw = process.env[envKey] ?? process.env.INDEXER_CONCURRENCY;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WORKER_CONCURRENCY;
}
