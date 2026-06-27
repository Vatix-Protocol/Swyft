import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DbMetricsService } from './db-metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [CacheModule],
  providers: [DbMetricsService],
  controllers: [MetricsController],
  exports: [DbMetricsService],
})
export class MetricsModule {}
