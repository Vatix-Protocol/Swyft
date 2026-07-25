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
 * Re-enqueues persisted events from `fromLedger` onward onto their BullMQ
 * queues so they're reprojected. Handlers upsert on eventId, so replayed
 * events that already landed are safely re-applied rather than duplicated.
 * Rows persisted before the `ledger` column existed have `ledger: null` and
 * are not replayable — only events tagged with a ledger can be selected.
 */
@Injectable()
export class IndexerReplayService {
  private readonly logger = new Logger(IndexerReplayService.name);
  private readonly prisma = new PrismaClient();
  private static readonly ENQUEUE_OPTS = { removeOnComplete: true };

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

  async replayFromLedger(fromLedger: number): Promise<ReplaySummary> {
    const [
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

    const total =
      poolCreated +
      swapProcessed +
      positionMinted +
      positionBurned +
      feesCollected;

    this.logger.log(
      `Replay from ledger ${fromLedger} enqueued ${total} event(s) ` +
        `(pool.created=${poolCreated}, swap.processed=${swapProcessed}, ` +
        `position.minted=${positionMinted}, position.burned=${positionBurned}, ` +
        `fees.collected=${feesCollected})`,
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
