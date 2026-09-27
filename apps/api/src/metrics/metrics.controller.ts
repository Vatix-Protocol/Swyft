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
import {
  internalKeyAuthOutcomes,
  loadKeyRing,
  matchKeyRing,
  recordKeyRingOutcome,
} from '../admin/internal-key-ring';
import { currentWalletOutcomes } from '../auth/current-wallet.decorator';
import { analyticsSchedulerMetrics } from '../admin/analytics-scheduler.metrics';

@ApiTags(SWAGGER_TAGS.INDEXER)
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly dbMetrics: DbMetricsService,
    private readonly indexerMonitor: IndexerMonitorService,
  ) {}

  @Get('db')
  async getDbMetrics(@Headers('x-internal-key') key: string) {
    this.assertInternalKey(key);
    return this.dbMetrics.snapshot();
  }

  @Get('indexer')
  async getIndexerMetrics(@Headers('x-internal-key') key: string) {
    this.assertInternalKey(key);
    return this.indexerMonitor.getMetrics();
  }

  @Get('security')
  @ApiOperation({
    summary:
      'Bounded-cardinality auth and analytics-scheduler counters (no secrets, wallets or ids)',
  })
  getSecurityMetrics(@Headers('x-internal-key') key: string) {
    this.assertInternalKey(key);
    return {
      internalKeyAuth: internalKeyAuthOutcomes.snapshot(),
      currentWallet: currentWalletOutcomes.snapshot(),
      analyticsScheduler: analyticsSchedulerMetrics.snapshot(),
    };
  }

  /** INTERNAL_API_KEY ring check, rotation-aware and constant-time (#1030). */
  private assertInternalKey(key: string | undefined): void {
    const match = matchKeyRing(key, loadKeyRing('INTERNAL_API_KEY'));
    recordKeyRingOutcome('metrics', match);
    if (!match.ok) throw new UnauthorizedException();
  }
}
