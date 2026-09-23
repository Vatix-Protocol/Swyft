import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import {
  QUEUE_POOL_CREATED,
  QUEUE_SWAP_PROCESSED,
  QUEUE_POSITION_MINTED,
  QUEUE_POSITION_BURNED,
  QUEUE_FEES_COLLECTED,
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
} from './queues';

export interface ReplaySummary {
  fromLedger: number;
  enqueued: {
    poolCreated: number;
    swapProcessed: number;
    positionMinted: number;
    positionBurned: number;
    feesCollected: number;
  };
  total: number;
}

/**
 * Stable error codes for DLQ replay entrypoints. Callers (controllers, ops
 * tooling) can branch on these without parsing messages, and they are safe to
 * surface to clients/logs (no payload or secret leakage).
 */
export const REPLAY_ERROR_CODES = {
  INVALID_CURSOR: 'REPLAY_INVALID_CURSOR',
  DEPENDENCY_UNAVAILABLE: 'REPLAY_DEPENDENCY_UNAVAILABLE',
  REPLAY_IN_PROGRESS: 'REPLAY_IN_PROGRESS',
} as const;

export type ReplayErrorCode =
  (typeof REPLAY_ERROR_CODES)[keyof typeof REPLAY_ERROR_CODES];

/**
 * Typed error thrown by replay entrypoints. Carries a stable `code` and the
 * `correlationId` of the originating request so ops can trace a failure end to
 * end without inspecting payload contents.
 */
export class ReplayError extends Error {
  constructor(
    readonly code: ReplayErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'ReplayError';
  }
}

export interface ReplayRequest {
  fromLedger: number;
  /** Caller-supplied idempotency key; concurrent replays with the same key dedupe. */
  idempotencyKey: string;
  /** Correlation id propagated through logs/metrics for this request. */
  correlationId: string;
}

export interface ReplayResult extends ReplaySummary {
  correlationId: string;
  idempotencyKey: string;
  /** True when this call was deduped against an in-flight/previous replay. */
  deduped: boolean;
}

/**
 * Re-enqueues persisted events from `fromLedger` onward onto their BullMQ
 * queues so they're reprojected. Handlers upsert on eventId, so replayed
 * events that already landed are safely re-applied rather than duplicated.
 * Rows persisted before the `ledger` column existed have `ledger: null` and
 * are not replayable — only events tagged with a ledger can be selected.
 *
 * Replay is a privileged, money-path-adjacent operation: entrypoints must be
 * authorized by the caller (deny-by-default) and are idempotent per
 * `idempotencyKey`. Dependency outages fail closed — no partial enqueue is
 * reported as success.
 */
@Injectable()
export class IndexerReplayService {
  private readonly logger = new Logger(IndexerReplayService.name);
  private readonly prisma = new PrismaClient();
  private static readonly ENQUEUE_OPTS = { removeOnComplete: true };

  /** In-flight replays keyed by idempotency key, for concurrent dedupe. */
  private readonly inFlight = new Map<string, Promise<ReplaySummary>>();

  constructor(
    @Inject(QUEUE_POOL_CREATED)
    private readonly poolCreatedQueue: Queue<PoolCreatedJobData>,
    @Inject(QUEUE_SWAP_PROCESSED)
    private readonly swapProcessedQueue: Queue<SwapProcessedJobData>,
    @Inject(QUEUE_POSITION_MINTED)
    private readonly positionMintedQueue: Queue<PositionMintedJobData>,
    @Inject(QUEUE_POSITION_BURNED)
    private readonly positionBurnedQueue: Queue<PositionBurnedJobData>,
    @Inject(QUEUE_FEES_COLLECTED)
    private readonly feesCollectedQueue: Queue<FeesCollectedJobData>,
  ) {}

  /**
   * Typed, idempotent replay entrypoint. Validates the cursor, dedupes
   * concurrent/replayed requests by `idempotencyKey`, and fails closed on
   * dependency outage. Emits ops-safe metrics/logs (counts only, no payloads).
   */
  async replay(request: ReplayRequest): Promise<ReplayResult> {
    const { fromLedger, idempotencyKey, correlationId } = request;

    if (!Number.isInteger(fromLedger) || fromLedger < 0) {
      this.logger.warn(
        `replay rejected code=${REPLAY_ERROR_CODES.INVALID_CURSOR} correlationId=${correlationId}`,
      );
      throw new ReplayError(
        REPLAY_ERROR_CODES.INVALID_CURSOR,
        'fromLedger must be a non-negative integer',
        correlationId,
      );
    }

    const existing = this.inFlight.get(idempotencyKey);
    if (existing) {
      this.logger.log(
        `replay deduped correlationId=${correlationId} idempotencyKey=${idempotencyKey}`,
      );
      const summary = await existing;
      return { ...summary, correlationId, idempotencyKey, deduped: true };
    }

    const run = this.replayFromLedger(fromLedger, correlationId);
    this.inFlight.set(idempotencyKey, run);
    try {
      const summary = await run;
      return { ...summary, correlationId, idempotencyKey, deduped: false };
    } finally {
      this.inFlight.delete(idempotencyKey);
    }
  }

  async replayFromLedger(
    fromLedger: number,
    correlationId = 'n/a',
  ): Promise<ReplaySummary> {
    let poolCreated: number;
    let swapProcessed: number;
    let positionMinted: number;
    let positionBurned: number;
    let feesCollected: number;

    try {
      [
        poolCreated,
        swapProcessed,
        positionMinted,
        positionBurned,
        feesCollected,
      ] = await Promise.all([
        this.replayPoolCreated(fromLedger),
        this.replaySwapProcessed(fromLedger),
        this.replayPositionMinted(fromLedger),
        this.replayPositionBurned(fromLedger),
        this.replayFeesCollected(fromLedger),
      ]);
    } catch (err) {
      // Fail closed: a DB/Redis/RPC outage must not be reported as success.
      this.logger.error(
        `replay failed code=${REPLAY_ERROR_CODES.DEPENDENCY_UNAVAILABLE} ` +
          `correlationId=${correlationId} fromLedger=${fromLedger}`,
      );
      throw new ReplayError(
        REPLAY_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        'replay dependency unavailable',
        correlationId,
      );
    }

    const total =
      poolCreated +
      swapProcessed +
      positionMinted +
      positionBurned +
      feesCollected;

    this.logger.log(
      `replay from ledger ${fromLedger} enqueued ${total} event(s) ` +
        `(pool.created=${poolCreated}, swap.processed=${swapProcessed}, ` +
        `position.minted=${positionMinted}, position.burned=${positionBurned}, ` +
        `fees.collected=${feesCollected}) correlationId=${correlationId}`,
    );

    return {
      fromLedger,
      enqueued: {
        poolCreated,
        swapProcessed,
        positionMinted,
        positionBurned,
        feesCollected,
      },
      total,
    };
  }

  private async replayPoolCreated(fromLedger: number): Promise<number> {
    const rows = await this.prisma.poolCreated.findMany({
      where: { ledger: { gte: fromLedger } },
      orderBy: { ledger: 'asc' },
    });
    if (!rows.length) return 0;

    await this.poolCreatedQueue.addBulk(
      rows.map((row) => ({
        name: row.eventId,
        data: {
          eventId: row.eventId,
          poolId: row.poolId,
          tokenA: row.tokenA,
          tokenB: row.tokenB,
          fee: row.fee,
          sqrtPriceX96: row.sqrtPriceX96,
          ledger: row.ledger ?? undefined,
        } satisfies PoolCreatedJobData,
        opts: IndexerReplayService.ENQUEUE_OPTS,
      })),
    );
    return rows.length;
  }

  private async replaySwapProcessed(fromLedger: number): Promise<number> {
    const rows = await this.prisma.swapProcessed.findMany({
      where: { ledger: { gte: fromLedger } },
      orderBy: { ledger: 'asc' },
    });
    if (!rows.length) return 0;

    await this.swapProcessedQueue.addBulk(
      rows.map((row) => ({
        name: row.eventId,
        data: {
          eventId: row.eventId,
          poolId: row.poolId,
          sender: row.sender,
          recipient: row.recipient,
          amount0: row.amount0,
          amount1: row.amount1,
          sqrtPriceX96: row.sqrtPriceX96,
          liquidity: row.liquidity,
          tick: row.tick,
          ledger: row.ledger ?? undefined,
        } satisfies SwapProcessedJobData,
        opts: IndexerReplayService.ENQUEUE_OPTS,
      })),
    );
    return rows.length;
  }

  private async replayPositionMinted(fromLedger: number): Promise<number> {
    const rows = await this.prisma.positionMinted.findMany({
      where: { ledger: { gte: fromLedger } },
      orderBy: { ledger: 'asc' },
    });
    if (!rows.length) return 0;

    await this.positionMintedQueue.addBulk(
      rows.map((row) => ({
        name: row.eventId,
        data: {
          eventId: row.eventId,
          poolId: row.poolId,
          tokenId: row.tokenId ?? '',
          owner: row.owner,
          tickLower: row.tickLower,
          tickUpper: row.tickUpper,
          liquidity: row.liquidity,
          amount0: row.amount0,
          amount1: row.amount1,
          ledger: row.ledger ?? undefined,
        } satisfies PositionMintedJobData,
        opts: IndexerReplayService.ENQUEUE_OPTS,
      })),
    );
    return rows.length;
  }

  private async replayPositionBurned(fromLedger: number): Promise<number> {
    const rows = await this.prisma.positionBurned.findMany({
      where: { ledger: { gte: fromLedger } },
      orderBy: { ledger: 'asc' },
    });
    if (!rows.length) return 0;

    await this.positionBurnedQueue.addBulk(
      rows.map((row) => ({
        name: row.eventId,
        data: {
          eventId: row.eventId,
          poolId: row.poolId,
          tokenId: row.tokenId ?? '',
          owner: row.owner,
          tickLower: row.tickLower,
          tickUpper: row.tickUpper,
          liquidity: row.liquidity,
          amount0: row.amount0,
          amount1: row.amount1,
          ledger: row.ledger ?? undefined,
        } satisfies PositionBurnedJobData,
        opts: IndexerReplayService.ENQUEUE_OPTS,
      })),
    );
    return rows.length;
  }

  private async replayFeesCollected(fromLedger: number): Promise<number> {
    const rows = await this.prisma.feesCollected.findMany({
      where: { ledger: { gte: fromLedger } },
      orderBy: { ledger: 'asc' },
    });
    if (!rows.length) return 0;

    await this.feesCollectedQueue.addBulk(
      rows.map((row) => ({
        name: row.eventId,
        data: {
          eventId: row.eventId,
          poolId: row.poolId,
          recipient: row.recipient,
          amount0: row.amount0,
          amount1: row.amount1,
          ledger: row.ledger ?? undefined,
        } satisfies FeesCollectedJobData,
        opts: IndexerReplayService.ENQUEUE_OPTS,
      })),
    );
    return rows.length;
  }
}
