import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { InternalKeyGuard } from './internal-key.guard';
import { TimeSeriesQueryDto } from './dto/analytics-query.dto';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.ADMIN)
@Controller('admin')
@UseGuards(InternalKeyGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly auditService: AdminAuditService,
  ) {}

  @Get('analytics/overview')
  @ApiOperation({ summary: 'Protocol overview metrics' })
  getOverview() {
    return this.analytics.getOverview();
  }

  @Get('analytics/tvl')
  @ApiOperation({ summary: 'TVL time series' })
  getTvl(@Query() query: TimeSeriesQueryDto) {
    return this.analytics.getTvl(query.interval!);
  }

  @Get('analytics/volume')
  @ApiOperation({ summary: 'Volume time series' })
  getVolume(@Query() query: TimeSeriesQueryDto) {
    return this.analytics.getVolume(query.interval!);
  }

  @Get('analytics/fees')
  @ApiOperation({ summary: 'Fees collected per pool' })
  getFees() {
    return this.analytics.getFees();
  }

  // ── Audit log ────────────────────────────────────────────────────────────

  @Get('audit')
  @ApiOperation({ summary: 'Recent admin API audit log entries' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  getAuditLog(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.findRecent(
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0,
    );
  }
}
