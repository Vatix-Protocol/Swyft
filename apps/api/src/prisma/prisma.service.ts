import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DbMetricsService } from '../metrics/db-metrics.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowThreshold = Number(process.env.DB_SLOW_QUERY_THRESHOLD_MS ?? 100);

  constructor(private readonly dbMetrics: DbMetricsService) {
    super({ log: [{ emit: 'event', level: 'query' }] });
  }

  onModuleInit() {
    // @ts-expect-error: Prisma emits 'query' events at runtime
    this.$on('query', (e: { query: string; params: string; duration: number }) => {
      this.dbMetrics.record(e.duration);

      if (e.duration >= 500) {
        this.logger.error(
          `SLOW_QUERY duration=${e.duration}ms query="${e.query}" params=${e.params}`,
        );
      } else if (e.duration >= this.slowThreshold) {
        this.logger.warn(`SLOW_QUERY duration=${e.duration}ms query="${e.query}"`);
      } else {
        this.logger.debug(`query duration=${e.duration}ms`);
      }
    });

    return this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
