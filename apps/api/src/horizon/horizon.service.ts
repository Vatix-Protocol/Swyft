import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Horizon } from '@stellar/stellar-sdk';
import { PriceService, PriceEvent } from '../price/price.service';
import { PoolsService } from '../pools/pools.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class HorizonService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizonService.name);
  private readonly server: Horizon.Server;
  private readonly contractId: string;
  private cursor = 'now';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly priceService: PriceService,
    private readonly poolsService: PoolsService,
     private readonly cache: CacheService,
  ) {
    this.server = new Horizon.Server(
      process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    );
    this.contractId = process.env.POOL_CONTRACT_ID ?? '';
  }

  onModuleInit() {
    if (!this.contractId) {
      this.logger.warn('POOL_CONTRACT_ID not set — Horizon indexer disabled');
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const page = await this.server
        .effects()
        .forAccount(this.contractId)
        .cursor(this.cursor)
        .order('asc')
        .limit(50)
        .call();

      for (const record of page.records) {
        this.cursor = record.paging_token;
        const event = this.toPrice(record as unknown as EffectRecord);
        if (!event) continue;

        this.priceService.broadcastPrice(event);
        await this.poolsService.handlePoolStateUpdate(event.poolId, {
          currentPrice: event.currentPrice,
        });
        
        if (event) {
          await this.cache.publish(
            `prices:${event.poolId}`,
            JSON.stringify(event),
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Horizon poll error: ${(err as Error).message}`);
    }
  }

  private toPrice(r: EffectRecord): PriceEvent | null {
    if (!r.amount) return null;
    const price = parseFloat(r.amount);
    return {
      poolId: this.contractId,
      currentPrice: r.amount,
      sqrtPrice: Math.sqrt(price).toFixed(7),
      tick: r.tick ?? 0,
      liquidity: r.liquidity ?? '0',
      timestamp: new Date(r.created_at).getTime(),
    };
  }
}

interface EffectRecord {
  paging_token: string;
  amount?: string;
  tick?: number;
  liquidity?: string;
  created_at: string;
}
