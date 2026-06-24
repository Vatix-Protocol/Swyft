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
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';

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
        const event = this.toPrice(record);
        if (event) {
          this.priceService.broadcastPrice(event);
          await this.poolsService.handlePoolStateUpdate(event.poolId, {
            currentPrice: event.currentPrice,
          });
          await this.cache.publish(
            `prices:${priceEvent.poolId}`,
            JSON.stringify(priceEvent),
          );
        }

        // The record has now been fully handled (or intentionally ignored),
        // so it is safe to make its ledger visible to lag monitoring. A
        // failed persistence path throws before this point and is retried.
        await this.advanceLedger(
          (record as unknown as IndexerEffectRecord).ledger,
        );
        this.cursor = record.paging_token;
      }
    } catch (err) {
      this.logger.warn(`Horizon poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
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
}
