import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DbMetricsService } from './db-metrics.service';
import { IndexerMonitorService } from './indexer-monitor.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.INDEXER)
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly dbMetrics: DbMetricsService,
    private readonly indexerMonitor: IndexerMonitorService,
  ) {}

  @Get('db')
  async getDbMetrics(@Headers('x-internal-key') key: string) {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException();
    return this.dbMetrics.snapshot();
  }

  @Get('worker-lag')
  @ApiOperation({
    summary: 'Worker lag metrics — use to monitor indexer catchup speed',
  })
  async getWorkerLag() {
    return this.indexerMonitor.getMetrics();
  }
}
