import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsWorker } from './stats.worker';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { createStatsQueue } from './stats.queue';
import { TvlAlertService } from './tvl-alert.service';
import { TvlAlertController } from './tvl-alert.controller';
import { UsdPriceFeedService } from './usd-price-feed.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [ScheduleModule.forRoot(), WebhooksModule],
  providers: [
    StatsWorker,
    StatsScheduler,
    TvlAlertService,
    UsdPriceFeedService,
    { provide: STATS_QUEUE, useFactory: createStatsQueue },
  ],
  controllers: [TvlAlertController],
  exports: [TvlAlertService],
})
export class StatsModule {}
