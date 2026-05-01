import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { DbMetricsService } from './db-metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly dbMetrics: DbMetricsService) {}

  @Get('db')
  async getDbMetrics(@Headers('x-internal-key') key: string) {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException();
    return this.dbMetrics.snapshot();
  }
}
