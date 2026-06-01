import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IndexerWorker } from './indexer.worker';
import { SWAGGER_TAGS } from '../swagger.constants';

export interface IndexerStatusResponse {
  /** True while workers are initialising or shutting down. */
  isLoading: boolean;
  /**
   * Human-readable status:
   * - `initializing` — workers are starting up
   * - `idle`         — workers are running with empty queues
   * - `processing`   — at least one queue has pending work
   */
  status: 'initializing' | 'idle' | 'processing';
  /**
   * Copy shown to clients when the indexer has no data yet.
   * Explains the current state and suggests the next step.
   */
  message: string;
}

@ApiTags(SWAGGER_TAGS.INDEXER)
@Controller('indexer')
export class IndexerController {
  constructor(private readonly worker: IndexerWorker) {}

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
}
