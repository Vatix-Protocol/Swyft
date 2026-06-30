import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DbMetricsService } from './db-metrics.service';
import { IndexerMonitorService } from './indexer-monitor.service';
import { MetricsController } from './metrics.controller';
import { IndexerMonitorService } from './indexer-monitor.service';

@Module({
  imports: [CacheModule],
  providers: [DbMetricsService, IndexerMonitorService],
  controllers: [MetricsController],
  exports: [DbMetricsService, IndexerMonitorService],
})
export class MetricsModule {}
