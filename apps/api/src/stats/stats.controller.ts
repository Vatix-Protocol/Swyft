import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CacheService, TTL } from '../cache/cache.service';
import { GlobalStats, StatsService } from './stats.service';
import { SWAGGER_TAGS } from '../swagger.constants';

const CACHE_KEY = 'stats:global';

@ApiTags(SWAGGER_TAGS.STATS)
@Controller('stats')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Returns platform-wide stats (TVL, volume, pool/position/swap counts).
   *
   * Cached for {@link TTL.GLOBAL_STATS} seconds so repeated calls hit Redis
   * instead of re-running the underlying aggregate queries against the DB.
   */
  @Get('global')
  @ApiOperation({ summary: 'Get platform-wide stats' })
  @ApiResponse({
    status: 200,
    description: `Global stats, cached for ${TTL.GLOBAL_STATS}s`,
  })
  async getGlobalStats(): Promise<GlobalStats> {
    const cached = await this.cacheService.get<GlobalStats>(CACHE_KEY);
    if (cached) {
      return cached;
    }

    const stats = await this.statsService.computeGlobalStats();
    await this.cacheService.set(CACHE_KEY, stats, TTL.GLOBAL_STATS);
    return stats;
  }
}
