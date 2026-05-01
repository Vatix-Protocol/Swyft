import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

export interface DbMetricsSnapshot {
  totalQueries: number;
  avgQueryTimeMs: number;
  p95QueryTimeMs: number;
  slowQueryCount: number;
  cacheHitRate: number | null;
}

@Injectable()
export class DbMetricsService {
  private durations: number[] = [];
  private slowCount = 0;
  private readonly slowThreshold = Number(process.env.DB_SLOW_QUERY_THRESHOLD_MS ?? 100);

  constructor(private readonly cache: CacheService) {}

  record(durationMs: number) {
    this.durations.push(durationMs);
    if (durationMs >= this.slowThreshold) this.slowCount++;
    // Keep a rolling window of 10 000 samples to avoid unbounded memory
    if (this.durations.length > 10_000) this.durations.shift();
  }

  async snapshot(): Promise<DbMetricsSnapshot> {
    const total = this.durations.length;
    const avg = total ? this.durations.reduce((a, b) => a + b, 0) / total : 0;

    const sorted = [...this.durations].sort((a, b) => a - b);
    const p95 = total ? sorted[Math.floor(total * 0.95)] : 0;

    // Cache hit rate: read from Redis key written by CacheService (best-effort)
    let cacheHitRate: number | null = null;
    try {
      const stats = await this.cache.get<{ hits: number; misses: number }>('metrics:cache:stats');
      if (stats && stats.hits + stats.misses > 0) {
        cacheHitRate = stats.hits / (stats.hits + stats.misses);
      }
    } catch {
      /* ignore */
    }

    return {
      totalQueries: total,
      avgQueryTimeMs: Math.round(avg * 100) / 100,
      p95QueryTimeMs: p95 ?? 0,
      slowQueryCount: this.slowCount,
      cacheHitRate,
    };
  }
}
