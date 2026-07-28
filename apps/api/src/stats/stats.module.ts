import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsWorker } from './stats.worker';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { createStatsQueue } from './stats.queue';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [StatsController],
  providers: [
    StatsWorker,
    StatsScheduler,
    StatsService,
    { provide: STATS_QUEUE, useFactory: createStatsQueue },
  ],
})
export class StatsModule {}
