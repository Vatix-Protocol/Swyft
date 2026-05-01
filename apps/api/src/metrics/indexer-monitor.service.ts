import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Horizon } from '@stellar/stellar-sdk';
import { CacheService } from '../cache/cache.service';

export const LAST_INDEXED_LEDGER_KEY = 'indexer:last_ledger';
const LEDGER_CLOSE_SECONDS = 5;

export type IndexerStatus = 'healthy' | 'degraded' | 'critical';

export interface IndexerMetrics {
  lastIndexedLedger: number;
  latestLedger: number;
  lagLedgers: number;
  lagSeconds: number;
  status: IndexerStatus;
}

@Injectable()
export class IndexerMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerMonitorService.name);
  private readonly horizon: Horizon.Server;
  private timer: NodeJS.Timeout | null = null;
  private lastStatus: IndexerStatus | null = null;

  constructor(private readonly cache: CacheService) {
    this.horizon = new Horizon.Server(
      process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    );
  }

  onModuleInit() {
    void this.check();
    this.timer = setInterval(() => void this.check(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async getMetrics(): Promise<IndexerMetrics> {
    const [latestLedgerStr, lastIndexedStr] = await Promise.all([
      this.fetchLatestLedger(),
      this.cache.get<number>(LAST_INDEXED_LEDGER_KEY),
    ]);

    const latestLedger = latestLedgerStr ?? 0;
    const lastIndexedLedger = lastIndexedStr ?? 0;
    const lagLedgers = Math.max(0, latestLedger - lastIndexedLedger);
    const lagSeconds = lagLedgers * LEDGER_CLOSE_SECONDS;
    const status = this.computeStatus(lagLedgers);

    return { lastIndexedLedger, latestLedger, lagLedgers, lagSeconds, status };
  }

  private async check(): Promise<void> {
    try {
      const metrics = await this.getMetrics();
      const { status, lagLedgers } = metrics;

      if (status !== this.lastStatus) {
        if (status === 'degraded') {
          this.logger.warn(`Indexer degraded — lag=${lagLedgers} ledgers`);
        } else if (status === 'critical') {
          this.logger.error(`Indexer critical — lag=${lagLedgers} ledgers`);
          this.triggerSentry(metrics);
        }
        this.lastStatus = status;
      }
    } catch (err) {
      this.logger.warn(`Lag check failed: ${(err as Error).message}`);
    }
  }

  private computeStatus(lagLedgers: number): IndexerStatus {
    if (lagLedgers < 10) return 'healthy';
    if (lagLedgers <= 50) return 'degraded';
    return 'critical';
  }

  private async fetchLatestLedger(): Promise<number> {
    const ledgers = await this.horizon.ledgers().order('desc').limit(1).call();
    return ledgers.records[0]?.sequence ?? 0;
  }

  private triggerSentry(metrics: IndexerMetrics): void {
    // Sentry is optional — only call if the SDK is initialised
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/node') as typeof import('@sentry/node');
      Sentry.captureMessage(
        `Indexer critical lag: ${metrics.lagLedgers} ledgers (${metrics.lagSeconds}s)`,
        'error',
      );
    } catch {
      // Sentry not installed — log only
    }
  }
}
