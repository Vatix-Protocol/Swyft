import { Queue } from 'bullmq';
import { makeQueueOptions } from '../indexer/queues';

export const STATS_QUEUE_NAME = 'stats.aggregate';
export const STATS_JOB_NAME = 'pool-stats';

export function createStatsQueue(): Queue {
  return new Queue(STATS_QUEUE_NAME, makeQueueOptions());
}
