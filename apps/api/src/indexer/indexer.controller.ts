import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IndexerWorker } from './indexer.worker';
import {
  DeadLetterReplayResponse,
  IndexerReplayService,
  ReplaySummary,
} from './indexer-replay.service';
import { ReplayDto } from './dto/replay.dto';
import {
  DLQ_ID_MAX_LENGTH,
  DLQ_ID_PATTERN,
  ReplayDeadLetterDto,
} from './dto/replay-dead-letter.dto';
import { InternalKeyGuard } from '../admin/internal-key.guard';
import { DlqReplayGuard, requestCorrelationId } from './dlq-replay.guard';
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
  async getStatus(): Promise<IndexerStatusResponse> {
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

    const queueDepth = await this.worker.getTotalQueueDepth();
    if (queueDepth > 0) {
      return {
        isLoading: false,
        status: 'processing',
        message:
          'The indexer is processing on-chain events. Data will update shortly.',
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
   *
   * Idempotency: callers SHOULD send an `x-idempotency-key` header. Concurrent
   * or replayed requests carrying the same key are deduplicated by the replay
   * service, so a retried operator request cannot double-enqueue events.
   */
  @Post('replay')
  @UseGuards(InternalKeyGuard)
  @ApiHeader({
    name: 'x-idempotency-key',
    required: false,
    description:
      'Optional dedupe key. Concurrent/replayed requests with the same key are collapsed into a single replay.',
  })
  @ApiOperation({
    summary: 'Replay persisted events from a given ledger onward (internal)',
    description:
      'Re-enqueues canonical event rows. Worker handlers upsert on eventId, so replay is safe if events already landed.',
  })
  replay(
    @Body() body: ReplayDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<ReplaySummary> {
    return this.replayService.replayFromLedger(body.fromLedger, idempotencyKey);
  }

  /**
   * Re-enqueues poison jobs from `indexer_dead_letter` (#1026).
   *
   * **Usage**
   * - `POST /indexer/dead-letters/replay` with `{ "jobId": "<bull-job-id>" }`
   *   re-enqueues that single DLQ payload (works even if previously recovered).
   * - `POST /indexer/dead-letters/replay` with `{}` re-enqueues all unrecovered
   *   DLQ rows (cap 500).
   *
   * **Authz** — `DlqReplayGuard`: `x-internal-key` must match the
   * INTERNAL_API_KEY ring (FEE_COLLECTOR_AUTH does not grant replay), the
   * `INDEXER_DLQ_REPLAY_ENABLED` kill switch must be on, mainnet additionally
   * needs `INDEXER_DLQ_REPLAY_MAINNET_ENABLED`, and requests are rate-limited.
   *
   * **Idempotency** — replays are idempotent at three layers: an optional
   * `x-idempotency-key` collapses concurrent/retried requests, BullMQ job ids
   * are stable (`dlq-replay:<jobId>`), and handlers upsert on `eventId` /
   * pool id / position keys, so a replay never double-applies balances/TVL.
   *
   * **Fail-closed** — if the dead-letter store is unreachable the request
   * fails with 503 `DLQ_REPLAY_DEPENDENCY_UNAVAILABLE` and nothing is
   * enqueued. See docs/INDEXER_DLQ_REPLAY.md.
   */
  @Post('dead-letters/replay')
  @UseGuards(DlqReplayGuard)
  @ApiHeader({
    name: 'x-internal-key',
    required: true,
    description: 'INTERNAL_API_KEY (current or in-window previous slot).',
  })
  @ApiHeader({
    name: 'x-idempotency-key',
    required: false,
    description:
      'Optional dedupe key ([A-Za-z0-9._:-], max 128). Retries with the same key and target return the original result.',
  })
  @ApiOperation({
    summary: 'Replay dead-letter indexer jobs (internal, idempotent)',
    description:
      'Re-enqueues DLQ payloads. Safe to call twice — upsert keys and stable BullMQ job ids prevent double-application of pool/swap projections.',
  })
  replayDeadLetters(
    @Body() body: ReplayDeadLetterDto,
    @Req() req: Request,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<DeadLetterReplayResponse> {
    const correlationId = requestCorrelationId(req);
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length > DLQ_ID_MAX_LENGTH ||
        !DLQ_ID_PATTERN.test(idempotencyKey))
    ) {
      throw new BadRequestException({
        code: 'DLQ_REPLAY_INVALID_IDEMPOTENCY_KEY',
        message:
          'x-idempotency-key may only contain letters, digits, ".", "_", ":" and "-" (max 128)',
        correlationId,
      });
    }
    return this.replayService.replayDeadLettersIdempotent({
      jobId: body.jobId,
      idempotencyKey,
      correlationId,
    });
  }
}
