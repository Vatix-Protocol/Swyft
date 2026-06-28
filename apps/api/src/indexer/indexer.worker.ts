import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job, QueueEvents } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TokenEnrichmentService } from '../tokens/token-enrichment.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
import {
  QUEUE_NAMES,
  makeQueueOptions,
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
} from './queues';

@Injectable()
export class IndexerWorker implements OnModuleInit, OnModuleDestroy {
  /**
   * Placeholder token address used when a pool is created from a state
   * update (e.g. a swap) that arrives before the pool.created event. The
   * real token addresses are backfilled by projectPoolCreated once that
   * authoritative event is processed.
   */
  private static readonly UNKNOWN_TOKEN_ADDRESS = 'unknown';
  private readonly logger = new Logger(IndexerWorker.name);
  private readonly prisma = new PrismaClient();
  private readonly workers: Worker[] = [];
  private readonly queueEvents: QueueEvents[] = [];
  private queueDepthTimer: NodeJS.Timeout | null = null;
  private _isLoading = false;
  private _isReady = false;

  constructor(
    private readonly cache: CacheService,
    private readonly webhooks: WebhooksService,
    private readonly tokenEnrichment: TokenEnrichmentService,
  ) {}

  get isLoading(): boolean {
    return this._isLoading;
  }

  async onModuleInit() {
    if (this._isReady || this._isLoading) return;

    this._isLoading = true;
    const connection = makeQueueOptions().connection;

    this.workers.push(
      this.makeWorker<PoolCreatedJobData>(QUEUE_NAMES.POOL_CREATED, (job) =>
        this.handlePoolCreated(job),
      ),
      this.makeWorker<SwapProcessedJobData>(QUEUE_NAMES.SWAP_PROCESSED, (job) =>
        this.handleSwapProcessed(job),
      ),
      this.makeWorker<PositionMintedJobData>(
        QUEUE_NAMES.POSITION_MINTED,
        (job) => this.handlePositionMinted(job),
      ),
      this.makeWorker<PositionBurnedJobData>(
        QUEUE_NAMES.POSITION_BURNED,
        (job) => this.handlePositionBurned(job),
      ),
      this.makeWorker<FeesCollectedJobData>(QUEUE_NAMES.FEES_COLLECTED, (job) =>
        this.handleFeesCollected(job),
      ),
    );

    for (const name of Object.values(QUEUE_NAMES)) {
      const qe = new QueueEvents(name, { connection });
      qe.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(
          `[DLQ] queue=${name} jobId=${jobId} reason=${failedReason}`,
        );
      });
      this.queueEvents.push(qe);
    }
    this._isReady = true;
    this.logger.log('Indexer workers ready');
    void this.logQueueDepths();
    this._isLoading = false;
    this.queueDepthTimer = setInterval(
      () => void this.logQueueDepths(),
      60_000,
    );
  }

  async onModuleDestroy() {
    this._isReady = false;
    if (this.queueDepthTimer) clearInterval(this.queueDepthTimer);
    await Promise.all([
      ...this.workers.map((w) => w.close()),
      ...this.queueEvents.map((qe) => qe.close()),
    ]);
    await this.prisma.$disconnect();
    this._isLoading = false;
    this.logger.log('Indexer workers shut down gracefully');
  }

  private makeWorker<T>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
  ): Worker<T> {
    const { connection } = makeQueueOptions();
    const guardedHandler = async (job: Job<T>) => {
      if (!this._isReady) {
        this.logger.warn(
          `queue=${queueName} jobId=${job.id} skipped — indexer not ready`,
        );
        return;
      }
      return handler(job);
    };
    const worker = new Worker<T>(queueName, guardedHandler, {
      connection,
      // When a process dies mid-job, BullMQ marks the job stalled after its
      // lock expires and retries it. The handlers are idempotent on eventId.
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    });

    worker.on('completed', (job) => {
      this.logger.log(`completed queue=${queueName} jobId=${job.id}`);
    });
    worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      this.logger.warn(
        `failed queue=${queueName} jobId=${job?.id} attempt=${attempts} err=${err.message}`,
      );
    });

    return worker;
  }

  private async logQueueDepths() {
    for (const worker of this.workers) {
      const counts = await worker.client
        .then(async (client) => {
          const waiting = await client.llen(`bull:${worker.name}:wait`);
          const active = await client.llen(`bull:${worker.name}:active`);
          return { waiting, active };
        })
        .catch(() => null);

      if (counts) {
        if (counts.waiting === 0 && counts.active === 0) {
          this.logger.debug(
            `queue=${worker.name} is empty — no events to process`,
          );
        } else {
          this.logger.log(
            `queue=${worker.name} waiting=${counts.waiting} active=${counts.active}`,
          );
        }
      }
    }
  }

  /**
   * Returns true when all required string fields on a job payload are
   * non-empty. Logs a warning and skips persistence for empty payloads so
   * a malformed event never crashes the worker or breaks downstream consumers.
   */
  private guardEmptyData(
    jobId: string | undefined,
    data: Record<string, unknown>,
  ): boolean {
    const empty = Object.entries(data).filter(
      ([key, v]) =>
        key !== 'ledger' && (v === null || v === undefined || v === ''),
    );
    if (empty.length > 0) {
      this.logger.warn(
        `Skipping job ${jobId ?? 'unknown'} — empty fields: ${empty.map(([k]) => k).join(', ')}. ` +
          'Check the upstream event emitter; no data was persisted for this event.',
      );
      return false;
    }
    return true;
  }

  private async handlePoolCreated(job: Job<PoolCreatedJobData>) {
    const d = job.data;
    if (!this.guardEmptyData(job.id, d as unknown as Record<string, unknown>))
      return;
    await this.prisma.poolCreated.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        tokenA: d.tokenA,
        tokenB: d.tokenB,
        fee: d.fee,
        sqrtPriceX96: d.sqrtPriceX96,
      },
    });

    await this.projectPoolCreated(d);

    this.webhooks
      .dispatch('pool.created', {
        poolId: d.poolId,
        tokenA: d.tokenA,
        tokenB: d.tokenB,
        fee: d.fee,
        sqrtPriceX96: d.sqrtPriceX96,
        eventId: d.eventId,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to dispatch pool.created webhook: ${err.message}`,
        );
      });

    await this.advanceLedger(job.id, d.ledger);
  }

  private async handleSwapProcessed(job: Job<SwapProcessedJobData>) {
    const d = job.data;
    if (!this.guardEmptyData(job.id, d as unknown as Record<string, unknown>))
      return;
    await this.prisma.swapProcessed.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        sender: d.sender,
        recipient: d.recipient,
        amount0: d.amount0,
        amount1: d.amount1,
        sqrtPriceX96: d.sqrtPriceX96,
        liquidity: d.liquidity,
        tick: d.tick,
      },
    });

    await this.projectSwapProcessed(d);

    this.webhooks
      .dispatch('swap.large', {
        poolId: d.poolId,
        sender: d.sender,
        recipient: d.recipient,
        amount0: d.amount0,
        amount1: d.amount1,
        sqrtPriceX96: d.sqrtPriceX96,
        liquidity: d.liquidity,
        tick: d.tick,
        eventId: d.eventId,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to dispatch swap.large webhook: ${err.message}`,
        );
      });

    await this.advanceLedger(job.id, d.ledger);
  }

  private async handlePositionMinted(job: Job<PositionMintedJobData>) {
    const d = job.data;
    if (!this.guardEmptyData(job.id, d as unknown as Record<string, unknown>))
      return;
    await this.prisma.positionMinted.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        owner: d.owner,
        tickLower: d.tickLower,
        tickUpper: d.tickUpper,
        liquidity: d.liquidity,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
    // Project into relational Position table when the event includes a tokenId.
    if (d.tokenId) {
      await this.prisma.position.upsert({
        where: { poolId_tokenId: { poolId: d.poolId, tokenId: d.tokenId } },
        update: { liquidity: d.liquidity },
        create: {
          poolId: d.poolId,
          tokenId: d.tokenId,
          ownerAddress: d.owner,
          lowerTick: d.tickLower,
          upperTick: d.tickUpper,
          liquidity: d.liquidity,
        },
      });
    }
    await this.advanceLedger(job.id, d.ledger);
  }

  private async handlePositionBurned(job: Job<PositionBurnedJobData>) {
    const d = job.data;
    if (!this.guardEmptyData(job.id, d as unknown as Record<string, unknown>))
      return;
    await this.prisma.positionBurned.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        owner: d.owner,
        tickLower: d.tickLower,
        tickUpper: d.tickUpper,
        liquidity: d.liquidity,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
    // Project into relational Position table when the event includes a tokenId.
    if (d.tokenId) {
      const isClosed = d.liquidity === '0';
      await this.prisma.position.upsert({
        where: { poolId_tokenId: { poolId: d.poolId, tokenId: d.tokenId } },
        update: {
          liquidity: d.liquidity,
          ...(isClosed ? { closedAt: new Date() } : {}),
        },
        create: {
          poolId: d.poolId,
          tokenId: d.tokenId,
          ownerAddress: d.owner,
          lowerTick: d.tickLower,
          upperTick: d.tickUpper,
          liquidity: d.liquidity,
          ...(isClosed ? { closedAt: new Date() } : {}),
        },
      });
    }
    await this.advanceLedger(job.id, d.ledger);
  }

  private async handleFeesCollected(job: Job<FeesCollectedJobData>) {
    const d = job.data;
    if (!this.guardEmptyData(job.id, d as unknown as Record<string, unknown>))
      return;
    await this.prisma.feesCollected.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        recipient: d.recipient,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
    await this.advanceLedger(job.id, d.ledger);
  }

  /** Advances the durable checkpoint only after the event write completed. */
  private async advanceLedger(jobId: string | undefined, ledger?: number) {
    if (ledger === undefined) return;

    if (!Number.isSafeInteger(ledger) || ledger < 0) {
      this.logger.warn(
        `Skipping ledger checkpoint for job ${jobId ?? 'unknown'} — invalid ledger: ${String(ledger)}`,
      );
      return;
    }

    const advanced = await this.cache.setMaxNumber(
      LAST_INDEXED_LEDGER_KEY,
      ledger,
    );
    if (!advanced) {
      this.logger.debug(
        `Ledger checkpoint unchanged or unavailable for job ${jobId ?? 'unknown'} ledger=${ledger}`,
      );
    }
  }

  private async projectPoolCreated(d: PoolCreatedJobData) {
    try {
      await Promise.all([
        this.prisma.token.upsert({
          where: { address: d.tokenA },
          update: {},
          create: {
            address: d.tokenA,
            symbol: d.tokenA.slice(0, 4),
            name: d.tokenA,
            decimals: 7,
          },
        }),
        this.prisma.token.upsert({
          where: { address: d.tokenB },
          update: {},
          create: {
            address: d.tokenB,
            symbol: d.tokenB.slice(0, 4),
            name: d.tokenB,
            decimals: 7,
          },
        }),
      ]);

      await this.prisma.pool.upsert({
        where: { id: d.poolId },
        // A swap/position event may have created a placeholder pool (see
        // projectSwapProcessed below) before this authoritative pool.created
        // event arrived. Overwrite the placeholder token/fee fields with the
        // real values in that case.
        update: {
          token0Address: d.tokenA,
          token1Address: d.tokenB,
          feeTier: parseInt(d.fee, 10),
          currentSqrtPrice: d.sqrtPriceX96,
          updatedAt: new Date(),
        },
        create: {
          id: d.poolId,
          token0Address: d.tokenA,
          token1Address: d.tokenB,
          feeTier: parseInt(d.fee, 10),
          currentSqrtPrice: d.sqrtPriceX96,
          currentTick: 0,
          liquidity: '0',
          tvl: '0',
          volume24h: '0',
          feeApr: '0',
        },
      });

      // Enrich both tokens with on-chain metadata after the pool is persisted.
      await Promise.allSettled([
        this.tokenEnrichment.enrichToken(d.tokenA),
        this.tokenEnrichment.enrichToken(d.tokenB),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to project pool ${d.poolId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async projectSwapProcessed(d: SwapProcessedJobData) {
    try {
      const timestamp = d.timestamp ? new Date(d.timestamp) : new Date();
      await this.prisma.swap.upsert({
        where: { eventId: d.eventId },
        update: {},
        create: {
          eventId: d.eventId,
          poolId: d.poolId,
          senderAddress: d.sender,
          recipientAddress: d.recipient,
          amount0: d.amount0,
          amount1: d.amount1,
          sqrtPriceAfter: d.sqrtPriceX96,
          tickAfter: d.tick,
          transactionHash: d.transactionHash ?? d.eventId,
          timestamp,
        },
      });

      // A swap can arrive before (or without) its pool's pool.created event,
      // e.g. when events are processed out of order or the creation event was
      // missed. Upsert instead of update so the pool is created on its first
      // state update rather than silently dropping the swap. The token/fee
      // fields are unknown at this point; projectPoolCreated backfills them
      // with the authoritative values if/when that event arrives.
      await this.prisma.pool.upsert({
        where: { id: d.poolId },
        update: {
          currentSqrtPrice: d.sqrtPriceX96,
          currentTick: d.tick,
          liquidity: d.liquidity,
          updatedAt: new Date(),
        },
        create: {
          id: d.poolId,
          token0Address: IndexerWorker.UNKNOWN_TOKEN_ADDRESS,
          token1Address: IndexerWorker.UNKNOWN_TOKEN_ADDRESS,
          feeTier: 0,
          currentSqrtPrice: d.sqrtPriceX96,
          currentTick: d.tick,
          liquidity: d.liquidity,
          tvl: '0',
          volume24h: '0',
          feeApr: '0',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to project swap ${d.eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async projectPositionMinted(d: PositionMintedJobData) {
    try {
      await this.prisma.position.upsert({
        where: { poolId_tokenId: { poolId: d.poolId, tokenId: d.tokenId } },
        update: {},
        create: {
          poolId: d.poolId,
          ownerAddress: d.owner,
          tokenId: d.tokenId,
          lowerTick: d.tickLower,
          upperTick: d.tickUpper,
          liquidity: d.liquidity,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to project position mint ${d.eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async projectPositionBurned(d: PositionBurnedJobData) {
    try {
      await this.prisma.position.update({
        where: { poolId_tokenId: { poolId: d.poolId, tokenId: d.tokenId } },
        data: { closedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Failed to project position burn ${d.eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
