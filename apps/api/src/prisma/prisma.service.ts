import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DbMetricsService } from '../metrics/db-metrics.service';

export type QuerySeverity = 'error' | 'warn' | 'debug';

/**
 * Classifies a query duration into a severity level.
 *
 * @param durationMs — query duration in milliseconds
 * @param warnThresholdMs — durations >= this are at least 'warn'
 * @param errorThresholdMs — durations >= this are 'error'
 */
export function classifyQueryDuration(
  durationMs: number,
  warnThresholdMs: number,
  errorThresholdMs: number,
): QuerySeverity {
  if (durationMs >= errorThresholdMs) {
    return 'error';
  }
  if (durationMs >= warnThresholdMs) {
    return 'warn';
  }
  return 'debug';
}

/**
 * Parses a numeric threshold from an environment variable, falling back to
 * `defaultValue` when the value is missing, non-numeric, or not a positive
 * finite number (so a misconfigured env var cannot silently disable
 * slow-query logging).
 */
export function parseThresholdMs(
  envValue: string | undefined,
  defaultValue: number,
): number {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowThreshold = parseThresholdMs(
    process.env.DB_SLOW_QUERY_THRESHOLD_MS,
    100,
  );
  private readonly errorThreshold = parseThresholdMs(
    process.env.DB_SLOW_QUERY_ERROR_THRESHOLD_MS,
    500,
  );

  constructor(private readonly dbMetrics: DbMetricsService) {
    super({ log: [{ emit: 'event', level: 'query' }] });
  }

  onModuleInit() {
    this.$on('query', (e: Prisma.QueryEvent) => {
      this.dbMetrics.record(e.duration);

      const severity = classifyQueryDuration(
        e.duration,
        this.slowThreshold,
        this.errorThreshold,
      );

      if (severity === 'error') {
        this.logger.error(
          `SLOW_QUERY duration=${e.duration}ms query="${e.query}" params=${e.params}`,
        );
      } else if (severity === 'warn') {
        this.logger.warn(
          `SLOW_QUERY duration=${e.duration}ms query="${e.query}"`,
        );
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
