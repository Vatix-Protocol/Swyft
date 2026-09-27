/**
 * AnalyticsScheduler (#1031). BullMQ and the analytics service are mocked so
 * the scheduler's policy (kill switch, interval clamp, retention, bounded
 * metrics, fail-closed) is tested without Redis/Postgres.
 */
const queueInstances: any[] = [];
const workerInstances: any[] = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    const q = {
      name,
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      removeJobScheduler: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    queueInstances.push(q);
    return q;
  }),
  Worker: jest.fn().mockImplementation((name: string, processor: unknown, opts: unknown) => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const w = {
      name,
      processor,
      opts,
      handlers,
      on: jest.fn((event: string, fn: (...args: any[]) => void) => {
        handlers[event] = fn;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    workerInstances.push(w);
    return w;
  }),
}));

// The real service pulls in Prisma/Redis; only recomputeAll is exercised.
jest.mock('./analytics.service', () => ({ AnalyticsService: class {} }));

import { Worker } from 'bullmq';
import {
  ANALYTICS_JOB_NAME,
  ANALYTICS_QUEUE_NAME,
  ANALYTICS_SCHEDULER_ID,
  AnalyticsScheduler,
  DEFAULT_ANALYTICS_INTERVAL_MS,
  MAX_ANALYTICS_INTERVAL_MS,
  MIN_ANALYTICS_INTERVAL_MS,
  resolveAnalyticsSchedulerConfig,
} from './analytics.scheduler';
import {
  analyticsSchedulerMetrics,
  classifyAnalyticsFailure,
} from './analytics-scheduler.metrics';

describe('resolveAnalyticsSchedulerConfig', () => {
  it('defaults to enabled every 15 minutes', () => {
    expect(resolveAnalyticsSchedulerConfig({})).toEqual({
      enabled: true,
      everyMs: DEFAULT_ANALYTICS_INTERVAL_MS,
    });
  });

  it.each(['false', 'FALSE', '0', 'off', ' no '])('kill switch %p disables', (v) => {
    expect(resolveAnalyticsSchedulerConfig({ ANALYTICS_SCHEDULER_ENABLED: v }).enabled).toBe(false);
  });

  it.each([
    ['1', MIN_ANALYTICS_INTERVAL_MS],
    ['999999999999', MAX_ANALYTICS_INTERVAL_MS],
    ['300000', 300000],
    ['abc', DEFAULT_ANALYTICS_INTERVAL_MS],
    ['-5', DEFAULT_ANALYTICS_INTERVAL_MS],
    ['1.5', DEFAULT_ANALYTICS_INTERVAL_MS],
  ])('clamps interval %p to %p', (raw, expected) => {
    expect(
      resolveAnalyticsSchedulerConfig({ ANALYTICS_REFRESH_INTERVAL_MS: raw }).everyMs,
    ).toBe(expected);
  });
});

describe('AnalyticsScheduler', () => {
  const saved = {
    enabled: process.env.ANALYTICS_SCHEDULER_ENABLED,
    interval: process.env.ANALYTICS_REFRESH_INTERVAL_MS,
  };
  let recomputeAll: jest.Mock;
  let scheduler: AnalyticsScheduler;

  beforeEach(() => {
    queueInstances.length = 0;
    workerInstances.length = 0;
    (Worker as unknown as jest.Mock).mockClear();
    analyticsSchedulerMetrics.reset();
    delete process.env.ANALYTICS_SCHEDULER_ENABLED;
    delete process.env.ANALYTICS_REFRESH_INTERVAL_MS;
    recomputeAll = jest.fn().mockResolvedValue(undefined);
    scheduler = new AnalyticsScheduler({ recomputeAll } as any);
  });

  afterAll(() => {
    process.env.ANALYTICS_SCHEDULER_ENABLED = saved.enabled;
    process.env.ANALYTICS_REFRESH_INTERVAL_MS = saved.interval;
    if (saved.enabled === undefined) delete process.env.ANALYTICS_SCHEDULER_ENABLED;
    if (saved.interval === undefined) delete process.env.ANALYTICS_REFRESH_INTERVAL_MS;
  });

  it('upserts one fixed scheduler id with bounded retention and a single-concurrency worker', async () => {
    await scheduler.onModuleInit();
    const [queue] = queueInstances;
    expect(queue.name).toBe(ANALYTICS_QUEUE_NAME);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      ANALYTICS_SCHEDULER_ID,
      { every: DEFAULT_ANALYTICS_INTERVAL_MS },
      {
        name: ANALYTICS_JOB_NAME,
        opts: {
          attempts: 1,
          removeOnComplete: { count: 5, age: 86400 },
          removeOnFail: { count: 50, age: 604800 },
        },
      },
    );
    expect(workerInstances[0].opts).toMatchObject({ concurrency: 1 });
    expect(analyticsSchedulerMetrics.snapshot().state).toBe('running');
  });

  it('is idempotent across replicas: every instance upserts the same scheduler id', async () => {
    await scheduler.onModuleInit();
    await new AnalyticsScheduler({ recomputeAll } as any).onModuleInit();
    const ids = queueInstances.map((q) => q.upsertJobScheduler.mock.calls[0][0]);
    expect(new Set(ids)).toEqual(new Set([ANALYTICS_SCHEDULER_ID]));
  });

  it('kill switch: starts no worker and removes the scheduler', async () => {
    process.env.ANALYTICS_SCHEDULER_ENABLED = 'false';
    await scheduler.onModuleInit();
    expect(workerInstances).toHaveLength(0);
    expect(queueInstances[0].upsertJobScheduler).not.toHaveBeenCalled();
    expect(queueInstances[0].removeJobScheduler).toHaveBeenCalledWith(ANALYTICS_SCHEDULER_ID);
    expect(analyticsSchedulerMetrics.snapshot().state).toBe('disabled');
  });

  it('does not crash boot when Redis is unavailable', async () => {
    const { Queue } = jest.requireMock('bullmq');
    Queue.mockImplementationOnce((name: string) => {
      const q = {
        name,
        upsertJobScheduler: jest.fn().mockRejectedValue(new Error('ECONNREFUSED redis://user:pw@host')),
        removeJobScheduler: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(q);
      return q;
    });
    const errorSpy = jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => {});
    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(analyticsSchedulerMetrics.snapshot().state).toBe('unavailable');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('pw@host');
  });

  it('processes the recompute job with a correlation id and records success', async () => {
    await scheduler.process({ id: 'repeat:1', name: ANALYTICS_JOB_NAME } as any);
    expect(recomputeAll).toHaveBeenCalledWith('analytics-refresh:repeat:1');
    const snap = analyticsSchedulerMetrics.snapshot();
    expect(snap.runs.success).toBe(1);
    expect(snap.lastSuccessAt).not.toBeNull();
  });

  it('drops unexpected job names without recomputing or retrying', async () => {
    await expect(
      scheduler.process({ id: '7', name: 'drop-tables' } as any),
    ).resolves.toBeUndefined();
    expect(recomputeAll).not.toHaveBeenCalled();
    expect(analyticsSchedulerMetrics.snapshot().runs.rejected_job).toBe(1);
  });

  it('fails closed: a recompute error propagates so the job is marked failed', async () => {
    recomputeAll.mockRejectedValue(
      Object.assign(new Error('db down'), { code: 'ANALYTICS_DEPENDENCY_UNAVAILABLE' }),
    );
    await expect(
      scheduler.process({ id: '8', name: ANALYTICS_JOB_NAME } as any),
    ).rejects.toThrow('db down');
    expect(analyticsSchedulerMetrics.snapshot().runs.success).toBe(0);
  });

  it('failure metrics stay bounded no matter how many distinct errors/job ids occur', async () => {
    await scheduler.onModuleInit();
    const onFailed = workerInstances[0].handlers.failed;
    const errorSpy = jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => {});
    for (let i = 0; i < 200; i++) {
      onFailed({ id: `job-${i}` }, Object.assign(new Error(`secret-${i}`), { code: `WEIRD_${i}` }));
    }
    onFailed(undefined, Object.assign(new Error('x'), { code: 'ANALYTICS_DEPENDENCY_UNAVAILABLE' }));

    const snap = analyticsSchedulerMetrics.snapshot();
    expect(snap.runs.failure).toBe(201);
    expect(snap.failures).toEqual({
      ANALYTICS_DEPENDENCY_UNAVAILABLE: 1,
      ANALYTICS_COMPUTATION_FAILED: 0,
      ANALYTICS_INVALID_INPUT: 0,
      UNKNOWN: 200,
      other: 0,
    });
    // Error messages never reach logs (could carry connection strings).
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('secret-');
  });

  it('closes worker and queue on shutdown', async () => {
    await scheduler.onModuleInit();
    await scheduler.onModuleDestroy();
    expect(workerInstances[0].close).toHaveBeenCalled();
    expect(queueInstances[0].close).toHaveBeenCalled();
    expect(analyticsSchedulerMetrics.snapshot().state).toBe('stopped');
  });

  it('classifyAnalyticsFailure maps foreign errors to UNKNOWN', () => {
    expect(classifyAnalyticsFailure(null)).toBe('UNKNOWN');
    expect(classifyAnalyticsFailure({ code: 'ANALYTICS_INVALID_INPUT' })).toBe(
      'ANALYTICS_INVALID_INPUT',
    );
  });
});
