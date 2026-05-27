import { Queue } from 'bullmq';
import {
  createQueue,
  defaultJobOptions,
  makeQueueOptions,
  QUEUE_NAMES,
  QueueName,
} from './queues';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect every Queue instance created during a test so we can close them. */
const createdQueues: Queue[] = [];

function trackQueue(q: Queue): Queue {
  createdQueues.push(q);
  return q;
}

afterEach(async () => {
  // Close all queues to avoid open handles between tests.
  await Promise.all(createdQueues.map((q) => q.close()));
  createdQueues.length = 0;
});

// ---------------------------------------------------------------------------
// QUEUE_NAMES
// ---------------------------------------------------------------------------

describe('QUEUE_NAMES', () => {
  it('exports the expected queue name constants', () => {
    expect(QUEUE_NAMES.POOL_CREATED).toBe('pool.created');
    expect(QUEUE_NAMES.SWAP_PROCESSED).toBe('swap.processed');
    expect(QUEUE_NAMES.POSITION_MINTED).toBe('position.minted');
    expect(QUEUE_NAMES.POSITION_BURNED).toBe('position.burned');
    expect(QUEUE_NAMES.FEES_COLLECTED).toBe('fees.collected');
  });

  it('has exactly 5 queue names', () => {
    expect(Object.keys(QUEUE_NAMES)).toHaveLength(5);
  });

  it('all values are non-empty strings', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// defaultJobOptions
// ---------------------------------------------------------------------------

describe('defaultJobOptions', () => {
  it('retries up to 3 times', () => {
    expect(defaultJobOptions.attempts).toBe(3);
  });

  it('uses exponential back-off starting at 1 second', () => {
    expect(defaultJobOptions.backoff).toEqual({
      type: 'exponential',
      delay: 1_000,
    });
  });

  it('keeps the last 100 completed jobs', () => {
    expect(defaultJobOptions.removeOnComplete).toEqual({ count: 100 });
  });

  it('does not remove failed jobs automatically', () => {
    expect(defaultJobOptions.removeOnFail).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeQueueOptions
// ---------------------------------------------------------------------------

describe('makeQueueOptions', () => {
  it('returns an object with a connection property', () => {
    const opts = makeQueueOptions();
    expect(opts).toHaveProperty('connection');
  });

  it('uses the REDIS_URL env variable when set', () => {
    const original = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://custom-host:1234';

    const opts = makeQueueOptions();
    expect((opts.connection as { url: string }).url).toBe(
      'redis://custom-host:1234',
    );

    process.env.REDIS_URL = original;
  });

  it('falls back to redis://localhost:6379 when REDIS_URL is unset', () => {
    const original = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const opts = makeQueueOptions();
    expect((opts.connection as { url: string }).url).toBe(
      'redis://localhost:6379',
    );

    process.env.REDIS_URL = original;
  });

  it('includes defaultJobOptions', () => {
    const opts = makeQueueOptions();
    expect(opts.defaultJobOptions).toEqual(defaultJobOptions);
  });

  it('returns a new object on each call (no shared reference)', () => {
    const a = makeQueueOptions();
    const b = makeQueueOptions();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// createQueue
// ---------------------------------------------------------------------------

describe('createQueue', () => {
  it('returns a BullMQ Queue instance', () => {
    const q = trackQueue(createQueue(QUEUE_NAMES.POOL_CREATED));
    expect(q).toBeInstanceOf(Queue);
  });

  it('sets the queue name correctly', () => {
    const q = trackQueue(createQueue(QUEUE_NAMES.SWAP_PROCESSED));
    expect(q.name).toBe(QUEUE_NAMES.SWAP_PROCESSED);
  });

  it('creates a distinct Queue instance for each call', () => {
    const a = trackQueue(createQueue(QUEUE_NAMES.POSITION_MINTED));
    const b = trackQueue(createQueue(QUEUE_NAMES.POSITION_MINTED));
    expect(a).not.toBe(b);
  });

  it('can create a queue for every defined queue name', () => {
    for (const name of Object.values(QUEUE_NAMES) as QueueName[]) {
      const q = trackQueue(createQueue(name));
      expect(q.name).toBe(name);
    }
  });
});
