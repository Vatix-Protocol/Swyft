import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import {
  QUEUE_NAMES,
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
  QueueName,
} from './queues';
import {
  DeadLetterEntry,
  IndexerDeadLetterService,
} from './indexer-dead-letter.service';

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

export interface DeadLetterReplaySummary {
  /** Job ids that were re-enqueued. */
  replayed: string[];
  /** Job ids skipped because the payload/queue was invalid. */
  skipped: string[];
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
    private readonly deadLetterService: IndexerDeadLetterService,
  ) {}

  /**
   * Re-enqueues dead-lettered jobs onto their original BullMQ queues.
   *
   * Handlers upsert on `eventId` (and pool/position natural keys), so replaying
   * the same DLQ item twice is idempotent: pool balances / TVL / swap rows are
   * not double-applied. Pass `jobId` to replay one entry (even if previously
   * marked recovered); omit it to replay all unrecovered entries.
   */
  async replayDeadLetters(jobId?: string): Promise<DeadLetterReplaySummary> {
    const entries = jobId
      ? await this.loadSingleDeadLetter(jobId)
      : await this.deadLetterService.getDeadLetters(undefined, 500, true);

    const replayed: string[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
      const ok = await this.enqueueDeadLetter(entry);
      if (!ok) {
        skipped.push(entry.jobId);
        continue;
      }
      await this.deadLetterService.clearDeadLetter(entry.jobId);
      replayed.push(entry.jobId);
    }

    this.logger.log(
      `DLQ replay enqueued=${replayed.length} skipped=${skipped.length}` +
        (jobId ? ` jobId=${jobId}` : ''),
    );

    return { replayed, skipped, total: replayed.length };
  }

  private async loadSingleDeadLetter(
    jobId: string,
  ): Promise<DeadLetterEntry[]> {
    const entry = await this.deadLetterService.getDeadLetter(jobId);
    if (!entry) {
      throw new NotFoundException(`Dead letter job not found: ${jobId}`);
    }
    return [entry];
  }

  private async enqueueDeadLetter(entry: DeadLetterEntry): Promise<boolean> {
    const queueName = entry.queueName as QueueName;
    const eventId =
      typeof entry.data.eventId === 'string' && entry.data.eventId
        ? entry.data.eventId
        : entry.eventId;
    if (!eventId) {
      this.logger.warn(
        `Skipping DLQ job ${entry.jobId} — missing eventId in payload`,
      );
      return false;
    }

    const opts = {
      ...IndexerReplayService.ENQUEUE_OPTS,
      // Stable job id so a second replay of the same DLQ item is a no-op in
      // BullMQ when the prior job is still present; workers remain upsert-safe
      // even if the job is re-added under a new id.
      jobId: `dlq-replay:${entry.jobId}`,
    };

    try {
      switch (queueName) {
        case QUEUE_NAMES.POOL_CREATED:
          await this.poolCreatedQueue.add(
            eventId,
            entry.data as unknown as PoolCreatedJobData,
            opts,
          );
          return true;
        case QUEUE_NAMES.SWAP_PROCESSED:
          await this.swapProcessedQueue.add(
            eventId,
            entry.data as unknown as SwapProcessedJobData,
            opts,
          );
          return true;
        case QUEUE_NAMES.POSITION_MINTED:
          await this.positionMintedQueue.add(
            eventId,
            entry.data as unknown as PositionMintedJobData,
            opts,
          );
          return true;
        case QUEUE_NAMES.POSITION_BURNED:
          await this.positionBurnedQueue.add(
            eventId,
            entry.data as unknown as PositionBurnedJobData,
            opts,
          );
          return true;
        case QUEUE_NAMES.FEES_COLLECTED:
          await this.feesCollectedQueue.add(
            eventId,
            entry.data as unknown as FeesCollectedJobData,
            opts,
          );
          return true;
        default:
          throw new BadRequestException(
            `Unsupported DLQ queueName: ${entry.queueName}`,
          );
      }
    } catch (err) {
      // BullMQ rejects duplicate jobId — treat as idempotent no-op success.
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists|Job with this? id/i.test(message)) {
        this.logger.debug(
          `DLQ replay job ${entry.jobId} already queued — treating as no-op`,
        );
        return true;
      }
      this.logger.error(`Failed to enqueue DLQ job ${entry.jobId}: ${message}`);
      return false;
    }
  }

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
