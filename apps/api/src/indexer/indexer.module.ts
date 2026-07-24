import { Module } from '@nestjs/common';
import { IndexerWorker } from './indexer.worker';
import { IndexerController } from './indexer.controller';
import {
  createQueue,
  QUEUE_NAMES,
  QUEUE_POOL_CREATED,
  QUEUE_SWAP_PROCESSED,
  QUEUE_POSITION_MINTED,
  QUEUE_POSITION_BURNED,
  QUEUE_FEES_COLLECTED,
} from './queues';
import { CacheModule } from '../cache/cache.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TokensModule } from '../tokens/tokens.module';
import { IndexerCursorService } from './indexer-cursor.service';
import { IndexerDeadLetterService } from './indexer-dead-letter.service';
import { IndexerReplayService } from './indexer-replay.service';

export {
  QUEUE_POOL_CREATED,
  QUEUE_SWAP_PROCESSED,
  QUEUE_POSITION_MINTED,
  QUEUE_POSITION_BURNED,
  QUEUE_FEES_COLLECTED,
};

@Module({
  imports: [CacheModule, WebhooksModule, TokensModule],
  controllers: [IndexerController],
  providers: [
    IndexerWorker,
    IndexerCursorService,
    IndexerDeadLetterService,
    IndexerReplayService,
    {
      provide: QUEUE_POOL_CREATED,
      useFactory: () => createQueue(QUEUE_NAMES.POOL_CREATED),
    },
    {
      provide: QUEUE_SWAP_PROCESSED,
      useFactory: () => createQueue(QUEUE_NAMES.SWAP_PROCESSED),
    },
    {
      provide: QUEUE_POSITION_MINTED,
      useFactory: () => createQueue(QUEUE_NAMES.POSITION_MINTED),
    },
    {
      provide: QUEUE_POSITION_BURNED,
      useFactory: () => createQueue(QUEUE_NAMES.POSITION_BURNED),
    },
    {
      provide: QUEUE_FEES_COLLECTED,
      useFactory: () => createQueue(QUEUE_NAMES.FEES_COLLECTED),
    },
  ],
  exports: [
    IndexerWorker,
    IndexerCursorService,
    QUEUE_POOL_CREATED,
    QUEUE_SWAP_PROCESSED,
    QUEUE_POSITION_MINTED,
    QUEUE_POSITION_BURNED,
    QUEUE_FEES_COLLECTED,
  ],
})
export class IndexerModule {}
