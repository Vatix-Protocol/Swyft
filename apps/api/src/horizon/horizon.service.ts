import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Horizon } from '@stellar/stellar-sdk';
import { PriceService, PriceEvent } from '../price/price.service';
import { PoolsService } from '../pools/pools.service';
import { CacheService } from '../cache/cache.service';
import { IndexerCursorService } from '../indexer/indexer-cursor.service';
import {
  QUEUE_POOL_CREATED,
  QUEUE_SWAP_PROCESSED,
  QUEUE_POSITION_MINTED,
  QUEUE_POSITION_BURNED,
  QUEUE_FEES_COLLECTED,
} from '../indexer/indexer.module';
import {
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
} from '../indexer/queues';
import { STELLAR_CONFIG_KEY, StellarConfig } from '../config/stellar.config';

export class HorizonTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Horizon request timed out after ${timeoutMs}ms`);
    this.name = 'HorizonTimeoutError';
  }
}

@Injectable()
export class HorizonService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizonService.name);
  private readonly server: Horizon.Server;
  private legacyPoolContractId = '';
  private poolFactoryContractId = '';
  /** Accounts currently polled for effects: the factory, the legacy single pool, and every pool it has created. */
  private readonly trackedAccounts = new Set<string>();
  /** Per-account Horizon paging cursor. */
  private readonly cursors = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;
  private readonly timeoutMs: number;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly priceService: PriceService,
    private readonly poolsService: PoolsService,
    private readonly cache: CacheService,
    private readonly cursorService: IndexerCursorService,
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
  ) {
    const stellarCfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
    this.server = new Horizon.Server(stellarCfg.horizonUrl);
    this.legacyPoolContractId = stellarCfg.poolContractId;
    this.poolFactoryContractId = stellarCfg.poolFactoryContractId;
    const configuredTimeout = Number(
      this.config.get<string>('HORIZON_TIMEOUT_MS') ?? 10_000,
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 10_000;
  }

  async onModuleInit() {
    if (this.poolFactoryContractId)
      this.trackedAccounts.add(this.poolFactoryContractId);
    if (this.legacyPoolContractId)
      this.trackedAccounts.add(this.legacyPoolContractId);
    if (this.trackedAccounts.size === 0) {
      this.logger.warn(
        'POOL_FACTORY_CONTRACT_ID / POOL_CONTRACT_ID not set — Horizon indexer disabled',
      );
      return;
    }
    const ledger = await this.cursorService.getLastLedger();
    const startCursor = ledger > 0 ? String(ledger) : 'now';
    for (const account of this.trackedAccounts)
      this.cursors.set(account, startCursor);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 5_000);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped || Date.now() < this.nextAttemptAt) return;
    this.polling = true;
    let anyFailure = false;
    try {
      for (const account of [...this.trackedAccounts]) {
        try {
          await this.pollAccount(account);
        } catch (err) {
          anyFailure = true;
          this.logger.warn(
            `Horizon poll error account=${account}: ${(err as Error).message}`,
          );
        }
      }
      if (anyFailure) {
        this.consecutiveFailures += 1;
        const backoffMs = Math.min(
          30_000,
          1_000 * 2 ** (this.consecutiveFailures - 1),
        );
        this.nextAttemptAt = Date.now() + backoffMs;
      } else {
        this.consecutiveFailures = 0;
        this.nextAttemptAt = 0;
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Polls a single account's effects. `accountId` may be the pool factory,
   * the legacy single pool, or a pool discovered via a `pool_created` event
   * on the factory — each pool is added to `trackedAccounts` the first time
   * it's seen so its own swaps/positions/fees get indexed too.
   */
  private async pollAccount(accountId: string): Promise<void> {
    const cursor = this.cursors.get(accountId) ?? 'now';
    const page = await this.withTimeout(
      this.server
        .effects()
        .forAccount(accountId)
        .cursor(cursor)
        .order('asc')
        .limit(50)
        .call(),
    );

    // Group records by ledger so we can batch-enqueue within each window.
    const byLedger = new Map<number | 'unknown', IndexerEffectRecord[]>();
    for (const record of page.records) {
      const typedRecord = record as unknown as IndexerEffectRecord;
      const key = typedRecord.ledger ?? 'unknown';
      if (!byLedger.has(key)) byLedger.set(key, []);
      byLedger.get(key)!.push(typedRecord);
    }

    for (const [, records] of byLedger) {
      for (const record of records) {
        const event = this.toPrice(record, accountId);
        if (event) {
          this.priceService.broadcastPrice(event);
          await this.poolsService.handlePoolStateUpdate(event.poolId, {
            currentPrice: event.currentPrice,
          });
          await this.cache.publish(
            `prices:${event.poolId}`,
            JSON.stringify(event),
          );
        }

        if (
          record.eventType?.toLowerCase() === 'pool_created' &&
          record.poolId &&
          !this.trackedAccounts.has(record.poolId)
        ) {
          this.trackedAccounts.add(record.poolId);
          this.cursors.set(record.poolId, cursor);
        }
      }

      // Enqueue the whole ledger window first. Only then advance the Horizon
      // paging token for that window. If addBulk fails mid-page, earlier
      // windows keep their paging progress and later ledgers are retried on
      // the next poll — we never skip a failed batch.
      //
      // The durable indexer ledger checkpoint is advanced by IndexerWorker
      // only after a successful Postgres write, not here after enqueue.
      await this.batchEnqueueLedgerWindow(records, accountId);
      for (const record of records) {
        this.cursors.set(accountId, record.paging_token);
      }
    }
  }

  private withTimeout<T>(request: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new HorizonTimeoutError(this.timeoutMs)),
        this.timeoutMs,
      );
      request.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Builds BullMQ job payloads for all events in a single ledger window and
   * enqueues them atomically via `addBulk`, reducing round-trips to Redis.
   */
  private async batchEnqueueLedgerWindow(
    records: IndexerEffectRecord[],
    accountId: string,
  ): Promise<void> {
    const poolCreatedJobs: { name: string; data: PoolCreatedJobData }[] = [];
    const swapProcessedJobs: {
      name: string;
      data: SwapProcessedJobData;
    }[] = [];
    const positionMintedJobs: {
      name: string;
      data: PositionMintedJobData;
    }[] = [];
    const positionBurnedJobs: {
      name: string;
      data: PositionBurnedJobData;
    }[] = [];
    const feesCollectedJobs: {
      name: string;
      data: FeesCollectedJobData;
    }[] = [];

    for (const record of records) {
      const eventType = record.eventType?.toLowerCase() ?? '';
      try {
        if (eventType === 'pool_created') {
          const data: PoolCreatedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? accountId,
            tokenA: record.tokenA ?? '',
            tokenB: record.tokenB ?? '',
            fee: record.fee ?? '0',
            sqrtPriceX96: record.sqrtPrice ?? '0',
            ledger: record.ledger,
          };
          if (data.tokenA && data.tokenB) {
            poolCreatedJobs.push({ name: data.eventId, data });
          }
        } else if (eventType === 'swap_processed') {
          const data: SwapProcessedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? accountId,
            sender: record.sender ?? '',
            recipient: record.recipient ?? '',
            amount0: record.amount0 ?? '0',
            amount1: record.amount1 ?? '0',
            sqrtPriceX96: record.sqrtPrice ?? '0',
            liquidity: record.liquidity ?? '0',
            tick: record.tick ?? 0,
            transactionHash: record.transactionHash,
            timestamp: record.created_at,
            ledger: record.ledger,
          };
          if (data.sender && data.recipient) {
            swapProcessedJobs.push({ name: data.eventId, data });
          }
        } else if (eventType === 'position_minted') {
          const data: PositionMintedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? accountId,
            tokenId: record.tokenId ?? '',
            owner: record.owner ?? '',
            tickLower: record.tickLower ?? 0,
            tickUpper: record.tickUpper ?? 0,
            liquidity: record.liquidity ?? '0',
            amount0: record.amount0 ?? '0',
            amount1: record.amount1 ?? '0',
            ledger: record.ledger,
          };
          if (data.owner && data.tokenId) {
            positionMintedJobs.push({ name: data.eventId, data });
          }
        } else if (eventType === 'position_burned') {
          const data: PositionBurnedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? accountId,
            tokenId: record.tokenId ?? '',
            owner: record.owner ?? '',
            tickLower: record.tickLower ?? 0,
            tickUpper: record.tickUpper ?? 0,
            liquidity: record.liquidity ?? '0',
            amount0: record.amount0 ?? '0',
            amount1: record.amount1 ?? '0',
            ledger: record.ledger,
          };
          if (data.owner && data.tokenId) {
            positionBurnedJobs.push({ name: data.eventId, data });
          }
        } else if (eventType === 'fees_collected') {
          const data: FeesCollectedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? accountId,
            recipient: record.recipient ?? '',
            amount0: record.amount0 ?? '0',
            amount1: record.amount1 ?? '0',
            ledger: record.ledger,
          };
          if (data.recipient) {
            feesCollectedJobs.push({ name: data.eventId, data });
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to build job for event ${record.eventId ?? record.paging_token}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const opts = { removeOnComplete: true };
    await Promise.all([
      poolCreatedJobs.length
        ? this.poolCreatedQueue.addBulk(
            poolCreatedJobs.map((j) => ({ ...j, opts })),
          )
        : Promise.resolve(),
      swapProcessedJobs.length
        ? this.swapProcessedQueue.addBulk(
            swapProcessedJobs.map((j) => ({ ...j, opts })),
          )
        : Promise.resolve(),
      positionMintedJobs.length
        ? this.positionMintedQueue.addBulk(
            positionMintedJobs.map((j) => ({ ...j, opts })),
          )
        : Promise.resolve(),
      positionBurnedJobs.length
        ? this.positionBurnedQueue.addBulk(
            positionBurnedJobs.map((j) => ({ ...j, opts })),
          )
        : Promise.resolve(),
      feesCollectedJobs.length
        ? this.feesCollectedQueue.addBulk(
            feesCollectedJobs.map((j) => ({ ...j, opts })),
          )
        : Promise.resolve(),
    ]);
  }

  private toPrice(
    r: IndexerEffectRecord,
    accountId: string,
  ): PriceEvent | null {
    if (!r.amount) return null;
    const price = Number(r.amount);
    if (!Number.isFinite(price) || price < 0) return null;
    return {
      poolId: r.poolId ?? accountId,
      currentPrice: r.amount,
      sqrtPrice: Math.sqrt(price).toFixed(7),
      tick: r.tick ?? 0,
      liquidity: r.liquidity ?? '0',
      timestamp: new Date(r.created_at).getTime(),
    };
  }
}

interface IndexerEffectRecord {
  paging_token: string;
  ledger?: number;
  amount?: string;
  tick?: number;
  liquidity?: string;
  created_at: string;
  eventType?: string;
  eventId?: string;
  poolId?: string;
  tokenA?: string;
  tokenB?: string;
  fee?: string;
  sqrtPrice?: string;
  sender?: string;
  recipient?: string;
  amount0?: string;
  amount1?: string;
  owner?: string;
  tokenId?: string;
  tickLower?: number;
  tickUpper?: number;
  transactionHash?: string;
}
