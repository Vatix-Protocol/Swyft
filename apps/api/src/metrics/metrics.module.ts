import { Module } from '@nestjs/common';
import { DbMetricsService } from './db-metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  providers: [DbMetricsService],
  controllers: [MetricsController],
  exports: [DbMetricsService],
})
export class MetricsModule {}
