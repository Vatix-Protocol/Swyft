import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { InternalKeyGuard } from './internal-key.guard';
import { TimeSeriesQueryDto } from './dto/analytics-query.dto';

@Controller('admin/analytics')
@UseGuards(InternalKeyGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  getOverview() {
    return this.analytics.getOverview();
  }

  @Get('tvl')
  getTvl(@Query() query: TimeSeriesQueryDto) {
    return this.analytics.getTvl(query.interval!);
  }

  @Get('volume')
  getVolume(@Query() query: TimeSeriesQueryDto) {
    return this.analytics.getVolume(query.interval!);
  }

  @Get('fees')
  getFees() {
    return this.analytics.getFees();
  }
}
