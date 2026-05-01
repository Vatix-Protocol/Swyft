import { Module } from '@nestjs/common';
import { IndexerWorker } from './indexer.worker';
import { createQueue, QUEUE_NAMES } from './queues';

export const QUEUE_POOL_CREATED = 'QUEUE_POOL_CREATED';
export const QUEUE_SWAP_PROCESSED = 'QUEUE_SWAP_PROCESSED';
export const QUEUE_POSITION_MINTED = 'QUEUE_POSITION_MINTED';
export const QUEUE_POSITION_BURNED = 'QUEUE_POSITION_BURNED';
export const QUEUE_FEES_COLLECTED = 'QUEUE_FEES_COLLECTED';

@Module({
  providers: [
    IndexerWorker,
    { provide: QUEUE_POOL_CREATED, useFactory: () => createQueue(QUEUE_NAMES.POOL_CREATED) },
    { provide: QUEUE_SWAP_PROCESSED, useFactory: () => createQueue(QUEUE_NAMES.SWAP_PROCESSED) },
    { provide: QUEUE_POSITION_MINTED, useFactory: () => createQueue(QUEUE_NAMES.POSITION_MINTED) },
    { provide: QUEUE_POSITION_BURNED, useFactory: () => createQueue(QUEUE_NAMES.POSITION_BURNED) },
    { provide: QUEUE_FEES_COLLECTED, useFactory: () => createQueue(QUEUE_NAMES.FEES_COLLECTED) },
  ],
  exports: [
    QUEUE_POOL_CREATED,
    QUEUE_SWAP_PROCESSED,
    QUEUE_POSITION_MINTED,
    QUEUE_POSITION_BURNED,
    QUEUE_FEES_COLLECTED,
  ],
})
export class IndexerModule {}
