import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsWorker } from './stats.worker';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { createStatsQueue } from './stats.queue';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { TvlAlertService } from './tvl-alert.service';
import { TvlAlertController } from './tvl-alert.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [ScheduleModule.forRoot(), WebhooksModule],
  providers: [
    StatsWorker,
    StatsScheduler,
    StatsService,
    TvlAlertService,
    { provide: STATS_QUEUE, useFactory: createStatsQueue },
  ],
  controllers: [TvlAlertController, StatsController],
  exports: [TvlAlertService],
})
export class StatsModule {}
