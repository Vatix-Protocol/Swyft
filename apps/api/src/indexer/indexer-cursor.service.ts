import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';

@Injectable()
export class IndexerCursorService {
  private readonly logger = new Logger(IndexerCursorService.name);
  private readonly prisma = new PrismaClient();
  private readonly CURSOR_ID = 'ledger';

  constructor(private readonly cache: CacheService) {}

  /**
   * Get the last processed ledger from cache first, then from database.
   * This enables recovery after process restart.
   */
  async getLastLedger(): Promise<number> {
    const cached = await this.cache.get<number>(LAST_INDEXED_LEDGER_KEY);
    if (Number.isSafeInteger(cached) && cached >= 0) {
      return cached;
    }

    // Fall back to database
    try {
      const cursor = await this.prisma.indexerCursor.findUnique({
        where: { id: this.CURSOR_ID },
      });
      if (cursor && Number.isSafeInteger(Number(cursor.cursor))) {
        const ledger = Number(cursor.cursor);
        await this.cache.setMaxNumber(LAST_INDEXED_LEDGER_KEY, ledger);
        return ledger;
      }
    } catch (err) {
      this.logger.error(
        `Failed to retrieve cursor from DB: ${(err as Error).message}`,
      );
    }

    return 0;
  }

  /**
   * Persist the last processed ledger to both cache and database.
   * Only advances if the new ledger is greater than the current one.
   */
  async advanceLedger(ledger: number): Promise<boolean> {
    if (!Number.isSafeInteger(ledger) || ledger < 0) {
      this.logger.warn(`Invalid ledger number: ${String(ledger)}`);
      return false;
    }

    try {
      const cacheUpdated = await this.cache.setMaxNumber(
        LAST_INDEXED_LEDGER_KEY,
        ledger,
      );
      const current = await this.prisma.indexerCursor.findUnique({
        where: { id: this.CURSOR_ID },
      });
      const currentLedger = current ? Number(current.cursor) : -1;
      const shouldPersist =
        !Number.isSafeInteger(currentLedger) || ledger > currentLedger;

      if (shouldPersist) {
        await this.prisma.indexerCursor.upsert({
          where: { id: this.CURSOR_ID },
          update: { cursor: String(ledger) },
          create: { id: this.CURSOR_ID, cursor: String(ledger) },
        });
        this.logger.debug(`Advanced ledger cursor to ${ledger}`);
      }

      return cacheUpdated || shouldPersist;
    } catch (err) {
      this.logger.error(`Failed to advance ledger: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
