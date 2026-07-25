import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IndexerWorker } from './indexer.worker';
import { IndexerReplayService, ReplaySummary } from './indexer-replay.service';
import { ReplayDto } from './dto/replay.dto';
import { InternalKeyGuard } from '../admin/internal-key.guard';
import { SWAGGER_TAGS } from '../swagger.constants';

export interface IndexerStatusResponse {
  /** True while workers are initialising or shutting down. */
  isLoading: boolean;
  /**
   * Human-readable status:
   * - `initializing`  — workers are starting up
   * - `idle`          — workers are running with empty queues
   * - `processing`    — at least one queue has pending work
   * - `shutting_down` — a SIGTERM/SIGINT was received; draining in-flight jobs
   */
  status: 'initializing' | 'idle' | 'processing' | 'shutting_down';
  /**
   * Copy shown to clients when the indexer has no data yet.
   * Explains the current state and suggests the next step.
   */
  message: string;
}

@ApiTags(SWAGGER_TAGS.INDEXER)
@Controller('indexer')
export class IndexerController {
  constructor(
    private readonly worker: IndexerWorker,
    private readonly replayService: IndexerReplayService,
  ) {}

  /**
   * Returns the current status of the indexer worker.
   *
   * Clients use this to decide whether to show a loading indicator or an
   * empty-state message while waiting for on-chain events to be indexed.
   */
  @Get('status')
  @ApiOperation({
    summary: 'Indexer status — use to show empty-state copy while syncing',
  })
  getStatus(): IndexerStatusResponse {
    if (this.worker.isShuttingDown) {
      return {
        isLoading: false,
        status: 'shutting_down',
        message:
          'The indexer is shutting down and draining in-flight events. New events will resume processing shortly.',
      };
    }

    if (this.worker.isLoading) {
      return {
        isLoading: true,
        status: 'initializing',
        message:
          'The indexer is starting up. On-chain data will appear here once syncing is complete.',
      };
    }

    return {
      isLoading: false,
      status: 'idle',
      message:
        'The indexer is running. Make a swap or add liquidity to start seeing your activity here.',
    };
  }

  /**
   * Re-enqueues every persisted event with `ledger >= fromLedger` onto its
   * BullMQ queue for reprocessing. Internal/operator use only — guarded by
   * `x-internal-key` since replaying can trigger duplicate webhook deliveries
   * for events that already landed (writes stay idempotent on eventId).
   */
  @Post('replay')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({
    summary: 'Replay persisted events from a given ledger onward (internal)',
  })
  replay(@Body() body: ReplayDto): Promise<ReplaySummary> {
    return this.replayService.replayFromLedger(body.fromLedger);
  }
}
