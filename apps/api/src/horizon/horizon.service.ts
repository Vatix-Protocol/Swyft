import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
} from '../indexer/indexer.module';
import {
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
} from '../indexer/queues';

@Injectable()
export class HorizonService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizonService.name);
  private readonly server: Horizon.Server;
  private readonly contractId: string;
  private cursor = 'now';
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;

  constructor(
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
  ) {
    this.server = new Horizon.Server(
      process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    );
    this.contractId = process.env.POOL_CONTRACT_ID ?? '';
  }

  async onModuleInit() {
    if (!this.contractId) {
      this.logger.warn('POOL_CONTRACT_ID not set — Horizon indexer disabled');
      return;
    }
    const ledger = await this.cursorService.getLastLedger();
    this.cursor = ledger > 0 ? String(ledger) : 'now';
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 5_000);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const page = await this.server
        .effects()
        .forAccount(this.contractId)
        .cursor(this.cursor)
        .order('asc')
        .limit(50)
        .call();

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
          const event = this.toPrice(record);
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
        }

        await this.batchEnqueueLedgerWindow(records);
      }

      // Advance cursor and ledger checkpoint after processing all records.
      for (const record of page.records) {
        const typedRecord = record as unknown as IndexerEffectRecord;
        await this.advanceLedger(typedRecord.ledger);
        this.cursor = record.paging_token;
      }
    } catch (err) {
      this.logger.warn(`Horizon poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /**
   * Builds BullMQ job payloads for all events in a single ledger window and
   * enqueues them atomically via `addBulk`, reducing round-trips to Redis.
   */
  private async batchEnqueueLedgerWindow(
    records: IndexerEffectRecord[],
  ): Promise<void> {
    type JobEntry = { name: string; data: PoolCreatedJobData | SwapProcessedJobData | PositionMintedJobData | PositionBurnedJobData };

    const poolCreatedJobs: JobEntry[] = [];
    const swapProcessedJobs: JobEntry[] = [];
    const positionMintedJobs: JobEntry[] = [];
    const positionBurnedJobs: JobEntry[] = [];

    for (const record of records) {
      const eventType = record.eventType?.toLowerCase() ?? '';
      try {
        if (eventType === 'pool_created') {
          const data: PoolCreatedJobData = {
            eventId: record.eventId ?? record.paging_token,
            poolId: record.poolId ?? this.contractId,
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
            poolId: record.poolId ?? this.contractId,
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
            poolId: record.poolId ?? this.contractId,
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
            poolId: record.poolId ?? this.contractId,
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
        ? this.poolCreatedQueue.addBulk(poolCreatedJobs.map((j) => ({ ...j, opts })))
        : Promise.resolve(),
      swapProcessedJobs.length
        ? this.swapProcessedQueue.addBulk(swapProcessedJobs.map((j) => ({ ...j, opts })))
        : Promise.resolve(),
      positionMintedJobs.length
        ? this.positionMintedQueue.addBulk(positionMintedJobs.map((j) => ({ ...j, opts })))
        : Promise.resolve(),
      positionBurnedJobs.length
        ? this.positionBurnedQueue.addBulk(positionBurnedJobs.map((j) => ({ ...j, opts })))
        : Promise.resolve(),
    ]);
  }

  private toPrice(r: IndexerEffectRecord): PriceEvent | null {
    if (!r.amount) return null;
    const price = Number(r.amount);
    if (!Number.isFinite(price) || price < 0) return null;
    return {
      poolId: this.contractId,
      currentPrice: r.amount,
      sqrtPrice: Math.sqrt(price).toFixed(7),
      tick: r.tick ?? 0,
      liquidity: r.liquidity ?? '0',
      timestamp: new Date(r.created_at).getTime(),
    };
  }

  private async advanceLedger(ledger?: number): Promise<void> {
    if (!Number.isSafeInteger(ledger) || ledger === undefined || ledger < 0) {
      return;
    }
    await this.cursorService.advanceLedger(ledger);
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
