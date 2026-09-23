import { Module } from '@nestjs/common';
import { StatsWorker } from './stats.worker';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { createStatsQueue } from './stats.queue';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { TvlAlertService } from './tvl-alert.service';
import { TvlAlertController } from './tvl-alert.controller';
import { UsdPriceFeedService } from './usd-price-feed.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  providers: [
    StatsWorker,
    StatsScheduler,
    StatsService,
    TvlAlertService,
    UsdPriceFeedService,
    { provide: STATS_QUEUE, useFactory: createStatsQueue },
  ],
  controllers: [TvlAlertController, StatsController],
  exports: [TvlAlertService],
})
export class StatsModule {}
