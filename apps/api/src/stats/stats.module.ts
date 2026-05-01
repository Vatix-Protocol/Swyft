import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsWorker } from './stats.worker';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { createStatsQueue } from './stats.queue';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    StatsWorker,
    StatsScheduler,
    { provide: STATS_QUEUE, useFactory: createStatsQueue },
  ],
})
export class StatsModule {}
