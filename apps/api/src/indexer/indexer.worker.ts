import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job, QueueEvents } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TokenEnrichmentService } from '../tokens/token-enrichment.service';
import { IndexerCursorService } from './indexer-cursor.service';
import { IndexerDeadLetterService } from './indexer-dead-letter.service';
import {
  QUEUE_NAMES,
  makeQueueOptions,
  getWorkerConcurrency,
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
  QueueName,
} from './queues';
import { PoolsRepository } from '../pools/pools.repository';

const tracer = trace.getTracer('swyft-indexer');

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
  private _isShuttingDown = false;
  /** Bounds how long a SIGTERM/SIGINT shutdown waits for in-flight jobs before giving up. */
  private static readonly SHUTDOWN_TIMEOUT_MS = Number(
    process.env.INDEXER_SHUTDOWN_TIMEOUT_MS ?? 25_000,
  );

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly tokenEnrichment: TokenEnrichmentService,
    private readonly cursorService: IndexerCursorService,
    private readonly deadLetterService: IndexerDeadLetterService,
  ) {}

  get isLoading(): boolean {
    return this._isLoading;
  }

  /** True from the moment a shutdown signal is received until cleanup finishes. */
  get isShuttingDown(): boolean {
    return this._isShuttingDown;
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

  /**
   * Invoked by Nest's shutdown hooks on SIGTERM/SIGINT (see main.ts's
   * `enableShutdownHooks()`). Stops routing new jobs immediately, then lets
   * BullMQ drain in-flight jobs — bounded by SHUTDOWN_TIMEOUT_MS so a stuck
   * job cannot hang the process past its deploy platform's kill timeout.
   */
  async onModuleDestroy() {
    this._isShuttingDown = true;
    this._isReady = false;
    this.logger.log(
      `Received shutdown signal — draining in-flight jobs (timeout ${IndexerWorker.SHUTDOWN_TIMEOUT_MS}ms)`,
    );
    if (this.queueDepthTimer) clearInterval(this.queueDepthTimer);

    const closeAll = Promise.all([
      ...this.workers.map((w) => w.close()),
      ...this.queueEvents.map((qe) => qe.close()),
    ]);
    await this.withTimeout(
      closeAll,
      IndexerWorker.SHUTDOWN_TIMEOUT_MS,
      'Timed out waiting for indexer workers to drain in-flight jobs — forcing shutdown',
    );

    await this.prisma.$disconnect();
    this._isLoading = false;
    this._isShuttingDown = false;
    this.logger.log('Indexer workers shut down gracefully');
  }

  /** Races `promise` against a timeout, logging (but not throwing) if the timeout wins. */
  private async withTimeout(
    promise: Promise<unknown>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<void> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(timeoutMessage);
        resolve();
      }, timeoutMs);
    });

    await Promise.race([promise.then(() => undefined), timeout]);
    clearTimeout(timer!);
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
      // Each event type is an independent, idempotent projection, so jobs of
      // the same type can safely run in parallel within this worker process.
      concurrency: getWorkerConcurrency(queueName as QueueName),
    });

    worker.on('completed', (job) => {
      this.logger.log(`completed queue=${queueName} jobId=${job.id}`);
    });
    worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      const defaultRetries = 3; // From defaultJobOptions
      const isDeadLettered = attempts >= defaultRetries;

      this.logger.warn(
        `failed queue=${queueName} jobId=${job?.id} attempt=${attempts} err=${err.message}`,
      );

      // Record to DLQ if max retries exceeded
      if (isDeadLettered && job) {
        const rawEventId = (job.data as Record<string, unknown>)?.eventId;
        const eventId =
          typeof rawEventId === 'string' || typeof rawEventId === 'number'
            ? String(rawEventId)
            : 'unknown';
        this.deadLetterService
          .recordDeadLetter({
            jobId: job.id || 'unknown',
            queueName,
            eventId,
            data: job.data as Record<string, unknown>,
            error: err.message,
            attemptsMade: attempts,
          })
          .catch((dlErr) => {
            this.logger.error(
              `Failed to record DLQ entry: ${(dlErr as Error).message}`,
            );
          });
      }
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
    await tracer.startActiveSpan(
      'indexer.pool_created',
      async (span) => {
        try {
          span.setAttributes({
            'indexer.queue': QUEUE_NAMES.POOL_CREATED,
            'indexer.job_id': job.id ?? '',
            'indexer.event_id': d.eventId,
            'indexer.pool_id': d.poolId,
            'indexer.ledger': d.ledger ?? 0,
          });

          if (
            !this.guardEmptyData(job.id, d as unknown as Record<string, unknown>)
          ) {
            span.setStatus({ code: SpanStatusCode.OK, message: 'skipped' });
            return;
          }

          // Stage: write raw event
          await tracer.startActiveSpan('indexer.pool_created.write', async (writeSpan) => {
            try {
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
                  ledger: d.ledger ?? null,
                },
              });
              writeSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
              writeSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              writeSpan.end();
            }
          });

          // Stage: project into relational tables
          await tracer.startActiveSpan('indexer.pool_created.project', async (projectSpan) => {
            try {
              await this.projectPoolCreated(d);
              projectSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
              projectSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              projectSpan.end();
            }
          });

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
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private async handleSwapProcessed(job: Job<SwapProcessedJobData>) {
    const d = job.data;
    await tracer.startActiveSpan(
      'indexer.swap_processed',
      async (span) => {
        try {
          span.setAttributes({
            'indexer.queue': QUEUE_NAMES.SWAP_PROCESSED,
            'indexer.job_id': job.id ?? '',
            'indexer.event_id': d.eventId,
            'indexer.pool_id': d.poolId,
            'indexer.ledger': d.ledger ?? 0,
          });

          if (
            !this.guardEmptyData(job.id, d as unknown as Record<string, unknown>)
          ) {
            span.setStatus({ code: SpanStatusCode.OK, message: 'skipped' });
            return;
          }

          // Stage: write raw event
          await tracer.startActiveSpan('indexer.swap_processed.write', async (writeSpan) => {
            try {
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
                  ledger: d.ledger ?? null,
                },
              });
              writeSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
              writeSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              writeSpan.end();
            }
          });

          // Stage: project into relational tables
          await tracer.startActiveSpan('indexer.swap_processed.project', async (projectSpan) => {
            try {
              await this.projectSwapProcessed(d);
              projectSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
              projectSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              projectSpan.end();
            }
          });

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
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private async handlePositionMinted(job: Job<PositionMintedJobData>) {
    const d = job.data;
    await tracer.startActiveSpan('indexer.position_minted', async (span) => {
      try {
        span.setAttributes({
          'indexer.queue': QUEUE_NAMES.POSITION_MINTED,
          'indexer.job_id': job.id ?? '',
          'indexer.event_id': d.eventId,
          'indexer.pool_id': d.poolId,
          'indexer.ledger': d.ledger ?? 0,
        });

        if (
          !this.guardEmptyData(job.id, d as unknown as Record<string, unknown>)
        ) {
          span.setStatus({ code: SpanStatusCode.OK, message: 'skipped' });
          return;
        }

        await tracer.startActiveSpan('indexer.position_minted.write', async (writeSpan) => {
          try {
            await this.prisma.positionMinted.upsert({
              where: { eventId: d.eventId },
              update: {},
              create: {
                eventId: d.eventId,
                poolId: d.poolId,
                tokenId: d.tokenId || null,
                owner: d.owner,
                tickLower: d.tickLower,
                tickUpper: d.tickUpper,
                liquidity: d.liquidity,
                amount0: d.amount0,
                amount1: d.amount1,
                ledger: d.ledger ?? null,
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
            writeSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            writeSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            throw err;
          } finally {
            writeSpan.end();
          }
        });

        await this.advanceLedger(job.id, d.ledger);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private async handlePositionBurned(job: Job<PositionBurnedJobData>) {
    const d = job.data;
    await tracer.startActiveSpan('indexer.position_burned', async (span) => {
      try {
        span.setAttributes({
          'indexer.queue': QUEUE_NAMES.POSITION_BURNED,
          'indexer.job_id': job.id ?? '',
          'indexer.event_id': d.eventId,
          'indexer.pool_id': d.poolId,
          'indexer.ledger': d.ledger ?? 0,
        });

        if (
          !this.guardEmptyData(job.id, d as unknown as Record<string, unknown>)
        ) {
          span.setStatus({ code: SpanStatusCode.OK, message: 'skipped' });
          return;
        }

        await tracer.startActiveSpan('indexer.position_burned.write', async (writeSpan) => {
          try {
            await this.prisma.positionBurned.upsert({
              where: { eventId: d.eventId },
              update: {},
              create: {
                eventId: d.eventId,
                poolId: d.poolId,
                tokenId: d.tokenId || null,
                owner: d.owner,
                tickLower: d.tickLower,
                tickUpper: d.tickUpper,
                liquidity: d.liquidity,
                amount0: d.amount0,
                amount1: d.amount1,
                ledger: d.ledger ?? null,
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
            writeSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            writeSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            throw err;
          } finally {
            writeSpan.end();
          }
        });

        await this.advanceLedger(job.id, d.ledger);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private async handleFeesCollected(job: Job<FeesCollectedJobData>) {
    const d = job.data;
    await tracer.startActiveSpan('indexer.fees_collected', async (span) => {
      try {
        span.setAttributes({
          'indexer.queue': QUEUE_NAMES.FEES_COLLECTED,
          'indexer.job_id': job.id ?? '',
          'indexer.event_id': d.eventId,
          'indexer.pool_id': d.poolId,
          'indexer.ledger': d.ledger ?? 0,
        });

        if (
          !this.guardEmptyData(job.id, d as unknown as Record<string, unknown>)
        ) {
          span.setStatus({ code: SpanStatusCode.OK, message: 'skipped' });
          return;
        }

        await tracer.startActiveSpan('indexer.fees_collected.write', async (writeSpan) => {
          try {
            await this.prisma.feesCollected.upsert({
              where: { eventId: d.eventId },
              update: {},
              create: {
                eventId: d.eventId,
                poolId: d.poolId,
                recipient: d.recipient,
                amount0: d.amount0,
                amount1: d.amount1,
                ledger: d.ledger ?? null,
              },
            });
            writeSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            writeSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            throw err;
          } finally {
            writeSpan.end();
          }
        });

        await this.advanceLedger(job.id, d.ledger);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
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

    const advanced = await this.cursorService.advanceLedger(ledger);
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

      const createdAt = d.timestamp ? new Date(d.timestamp) : new Date();

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
          createdAt,
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

  /**
   * Resolves the fee amount for a swap. Uses the event-level feeAmount when
   * the upstream producer provides one; otherwise derives it from the pool's
   * feeTier (parts-per-million applied to |amount0|).
   */
  private async resolveFeeAmount(d: SwapProcessedJobData): Promise<string> {
    if (d.feeAmount !== undefined && d.feeAmount !== '') {
      return d.feeAmount;
    }
    try {
      const pool = await this.prisma.pool.findUnique({
        where: { id: d.poolId },
        select: { feeTier: true },
      });
      if (pool) {
        const absAmount0 = Math.abs(Number(d.amount0));
        const fee = absAmount0 * (pool.feeTier / 1_000_000);
        return Number.isFinite(fee) ? String(fee) : '0';
      }
    } catch {
      // Non-fatal: fee computation failure must not block swap persistence.
    }
    return '0';
  }

  private async projectSwapProcessed(d: SwapProcessedJobData) {
    try {
      const feeAmount = await this.resolveFeeAmount(d);

      if (!PoolsRepository.isValidSqrtPrice(d.sqrtPriceX96)) {
        this.logger.warn(
          `Skipping pool state update for swap ${d.eventId} — invalid sqrtPriceX96: "${d.sqrtPriceX96}"`,
        );
        // Still persist the swap row; only skip the pool sqrt-price update.
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
            feeAmount,
            timestamp,
          },
        });
        return;
      }

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
          feeAmount,
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
