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
import { PrismaService } from '../prisma/prisma.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
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
import { STELLAR_CONFIG_KEY, StellarConfig } from '../config/stellar.config';

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
    private readonly config: ConfigService,
    private readonly priceService: PriceService,
    private readonly poolsService: PoolsService,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    @Inject(QUEUE_POOL_CREATED)
    private readonly poolCreatedQueue: Queue<PoolCreatedJobData>,
    @Inject(QUEUE_SWAP_PROCESSED)
    private readonly swapProcessedQueue: Queue<SwapProcessedJobData>,
    @Inject(QUEUE_POSITION_MINTED)
    private readonly positionMintedQueue: Queue<PositionMintedJobData>,
    @Inject(QUEUE_POSITION_BURNED)
    private readonly positionBurnedQueue: Queue<PositionBurnedJobData>,
  ) {
    const stellarCfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
    this.server = new Horizon.Server(stellarCfg.horizonUrl);
    this.contractId = stellarCfg.poolContractId;
  }

  async onModuleInit() {
    if (!this.contractId) {
      this.logger.warn('POOL_CONTRACT_ID not set — Horizon indexer disabled');
      return;
    }
    const checkpoint = await this.prisma.indexerCursor.findUnique({
      where: { id: this.cursorId() },
    });
    this.cursor = checkpoint?.cursor ?? 'now';
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

      for (const record of page.records) {
        const typedRecord = record as unknown as IndexerEffectRecord;
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

        await this.enqueueIndexerEvents(typedRecord);

        await this.advanceLedger(typedRecord.ledger);
        this.cursor = record.paging_token;
      }
    } catch (err) {
      this.logger.warn(`Horizon poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async enqueueIndexerEvents(
    record: IndexerEffectRecord,
  ): Promise<void> {
    const eventType = record.eventType?.toLowerCase() ?? '';

    try {
      if (eventType === 'pool_created') {
        const jobData: PoolCreatedJobData = {
          eventId: record.eventId ?? record.paging_token,
          poolId: record.poolId ?? this.contractId,
          tokenA: record.tokenA ?? '',
          tokenB: record.tokenB ?? '',
          fee: record.fee ?? '0',
          sqrtPriceX96: record.sqrtPrice ?? '0',
          ledger: record.ledger,
        };
        if (jobData.tokenA && jobData.tokenB) {
          await this.poolCreatedQueue.add(jobData.eventId, jobData, {
            removeOnComplete: true,
          });
        }
      } else if (eventType === 'swap_processed') {
        const jobData: SwapProcessedJobData = {
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
        if (jobData.sender && jobData.recipient) {
          await this.swapProcessedQueue.add(jobData.eventId, jobData, {
            removeOnComplete: true,
          });
        }
      } else if (eventType === 'position_minted') {
        const jobData: PositionMintedJobData = {
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
        if (jobData.owner && jobData.tokenId) {
          await this.positionMintedQueue.add(jobData.eventId, jobData, {
            removeOnComplete: true,
          });
        }
      } else if (eventType === 'position_burned') {
        const jobData: PositionBurnedJobData = {
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
        if (jobData.owner && jobData.tokenId) {
          await this.positionBurnedQueue.add(jobData.eventId, jobData, {
            removeOnComplete: true,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue event ${record.eventId ?? record.paging_token}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    await this.cache.setMaxNumber(LAST_INDEXED_LEDGER_KEY, ledger);
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
