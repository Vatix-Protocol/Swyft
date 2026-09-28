/**
 * #1026 — Dead-letter replay authz, end to end through Nest: guard, DTO
 * validation, idempotency and fail-closed behaviour. Only the DLQ store and
 * BullMQ queues are stubbed.
 */
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: jest.fn(),
  })),
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IndexerController } from './indexer.controller';
import { IndexerWorker } from './indexer.worker';
import {
  dlqReplayOutcomes,
  IndexerReplayService,
} from './indexer-replay.service';
import {
  DeadLetterStoreUnavailableError,
  IndexerDeadLetterService,
} from './indexer-dead-letter.service';
import {
  QUEUE_FEES_COLLECTED,
  QUEUE_NAMES,
  QUEUE_POOL_CREATED,
  QUEUE_POSITION_BURNED,
  QUEUE_POSITION_MINTED,
  QUEUE_SWAP_PROCESSED,
} from './queues';
import {
  DLQ_REPLAY_AUTH_ERRORS,
  dlqReplayAuthOutcomes,
  dlqReplayRateLimiter,
} from './dlq-replay.guard';
import { internalKeyAuthOutcomes } from '../admin/internal-key-ring';

const KEY = 'test-internal-key-0123456789';
const PATH = '/indexer/dead-letters/replay';

const ENV_KEYS = [
  'INTERNAL_API_KEY',
  'INTERNAL_API_KEY_PREVIOUS',
  'INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT',
  'FEE_COLLECTOR_AUTH',
  'INDEXER_DLQ_REPLAY_ENABLED',
  'INDEXER_DLQ_REPLAY_MAINNET_ENABLED',
  'INDEXER_DLQ_REPLAY_MAX_PER_MINUTE',
  'STELLAR_NETWORK',
];

const swapEntry = {
  jobId: 'job-swap-1',
  queueName: QUEUE_NAMES.SWAP_PROCESSED,
  eventId: 'evt-swap-1',
  data: { eventId: 'evt-swap-1', poolId: 'pool-1' },
  error: 'boom',
  attemptsMade: 3,
};

describe('POST /indexer/dead-letters/replay (#1026)', () => {
  let app: INestApplication;
  const savedEnv: Record<string, string | undefined> = {};

  const queue = () => ({ add: jest.fn().mockResolvedValue({ id: '1' }) });
  const queues = {
    pool: queue(),
    swap: queue(),
    minted: queue(),
    burned: queue(),
    fees: queue(),
  };
  const deadLetters = {
    getDeadLetter: jest.fn(),
    getDeadLetters: jest.fn(),
    clearDeadLetter: jest.fn().mockResolvedValue(undefined),
  };

  const authed = () =>
    request(app.getHttpServer()).post(PATH).set('x-internal-key', KEY);

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    const module = await Test.createTestingModule({
      controllers: [IndexerController],
      providers: [
        IndexerReplayService,
        { provide: IndexerWorker, useValue: {} },
        { provide: IndexerDeadLetterService, useValue: deadLetters },
        { provide: QUEUE_POOL_CREATED, useValue: queues.pool },
        { provide: QUEUE_SWAP_PROCESSED, useValue: queues.swap },
        { provide: QUEUE_POSITION_MINTED, useValue: queues.minted },
        { provide: QUEUE_POSITION_BURNED, useValue: queues.burned },
        { provide: QUEUE_FEES_COLLECTED, useValue: queues.fees },
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.INTERNAL_API_KEY = KEY;
    process.env.INDEXER_DLQ_REPLAY_ENABLED = 'true';
    process.env.STELLAR_NETWORK = 'testnet';
    dlqReplayRateLimiter.reset();
    dlqReplayAuthOutcomes.reset();
    dlqReplayOutcomes.reset();
    internalKeyAuthOutcomes.reset();
    deadLetters.getDeadLetter.mockResolvedValue(swapEntry);
    deadLetters.getDeadLetters.mockResolvedValue([swapEntry]);
  });

  // ── Authn / authz negatives ────────────────────────────────────────────────

  it('rejects a missing key with 401 and a correlation id', async () => {
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('x-correlation-id', 'corr-1')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      code: DLQ_REPLAY_AUTH_ERRORS.MISSING_KEY,
      correlationId: 'corr-1',
    });
    expect(queues.swap.add).not.toHaveBeenCalled();
  });

  it('rejects a wrong key with 401 and never echoes it', async () => {
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('x-internal-key', 'wrong-key-value')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.INVALID_KEY);
    expect(JSON.stringify(res.body)).not.toContain('wrong-key-value');
    expect(internalKeyAuthOutcomes.snapshot()['dlq_replay:invalid']).toBe(1);
  });

  it('fails closed when INTERNAL_API_KEY is not configured', async () => {
    delete process.env.INTERNAL_API_KEY;
    const res = await authed().send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.NOT_CONFIGURED);
  });

  it('does not accept FEE_COLLECTOR_AUTH as a replay credential', async () => {
    process.env.FEE_COLLECTOR_AUTH = 'fee-collector-secret';
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('x-internal-key', 'fee-collector-secret')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.INVALID_KEY);
  });

  it('rejects an expired previous-slot key', async () => {
    process.env.INTERNAL_API_KEY_PREVIOUS = 'old-key-0123456789';
    process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = new Date(
      Date.now() - 1000,
    ).toISOString();
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('x-internal-key', 'old-key-0123456789')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.EXPIRED);
  });

  it('rejects a wrong role with 403', async () => {
    const res = await authed()
      .set('x-dlq-replay-role', 'fee-collector')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.WRONG_ROLE);
  });

  it.each(['0', 'not-a-number', String(Date.now() - 1)])(
    'rejects an expired/invalid x-dlq-replay-expires-at=%s',
    async (value) => {
      const res = await authed().set('x-dlq-replay-expires-at', value).send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.EXPIRED);
    },
  );

  it('accepts the operator role with a future expiry', async () => {
    const res = await authed()
      .set('x-dlq-replay-role', 'indexer-operator')
      .set('x-dlq-replay-expires-at', String(Date.now() + 60_000))
      .send({ jobId: 'job-swap-1' });
    expect(res.status).toBe(201);
  });

  // ── Kill switch / network ──────────────────────────────────────────────────

  it('is disabled unless INDEXER_DLQ_REPLAY_ENABLED=true', async () => {
    delete process.env.INDEXER_DLQ_REPLAY_ENABLED;
    const res = await authed().send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.DISABLED);
    expect(queues.swap.add).not.toHaveBeenCalled();
  });

  it('checks auth before the kill switch (no flag disclosure)', async () => {
    delete process.env.INDEXER_DLQ_REPLAY_ENABLED;
    const res = await request(app.getHttpServer()).post(PATH).send({});
    expect(res.status).toBe(401);
  });

  it('requires a separate opt-in on mainnet', async () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    const denied = await authed().send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.MAINNET_DISABLED);

    process.env.INDEXER_DLQ_REPLAY_MAINNET_ENABLED = 'true';
    const allowed = await authed().send({ jobId: 'job-swap-1' });
    expect(allowed.status).toBe(201);
  });

  it('rate-limits authorised callers with 429 and retryAfterMs', async () => {
    process.env.INDEXER_DLQ_REPLAY_MAX_PER_MINUTE = '2';
    await authed().send({ jobId: 'job-swap-1' }).expect(201);
    await authed().send({ jobId: 'job-swap-1' }).expect(201);
    const res = await authed().send({ jobId: 'job-swap-1' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe(DLQ_REPLAY_AUTH_ERRORS.RATE_LIMITED);
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(dlqReplayAuthOutcomes.snapshot().rate_limited).toBe(1);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it.each(['job\nforged-log-line', '../../etc/passwd', 'x'.repeat(129), ''])(
    'rejects adversarial jobId %j with 400',
    async (jobId) => {
      const res = await authed().send({ jobId });
      expect(res.status).toBe(400);
      expect(deadLetters.getDeadLetter).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed idempotency key with 400', async () => {
    const res = await authed()
      .set('x-idempotency-key', 'bad key!')
      .send({ jobId: 'job-swap-1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DLQ_REPLAY_INVALID_IDEMPOTENCY_KEY');
  });

  // ── Happy path, idempotency, fail-closed ───────────────────────────────────

  it('replays a single job and returns a correlation id', async () => {
    const res = await authed()
      .set('x-correlation-id', 'corr-ok')
      .send({ jobId: 'job-swap-1' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      replayed: ['job-swap-1'],
      skipped: [],
      total: 1,
      correlationId: 'corr-ok',
      deduplicated: false,
    });
    expect(queues.swap.add).toHaveBeenCalledWith(
      'evt-swap-1',
      expect.anything(),
      expect.objectContaining({ jobId: 'dlq-replay:job-swap-1' }),
    );
  });

  it('dedupes a retried request with the same idempotency key', async () => {
    await authed()
      .set('x-idempotency-key', 'op-retry-1')
      .send({ jobId: 'job-swap-1' })
      .expect(201);
    const retry = await authed()
      .set('x-idempotency-key', 'op-retry-1')
      .send({ jobId: 'job-swap-1' });
    expect(retry.status).toBe(201);
    expect(retry.body.deduplicated).toBe(true);
    expect(queues.swap.add).toHaveBeenCalledTimes(1);
  });

  it('re-runs a keyless replay instead of serving a cached result', async () => {
    await authed().send({ jobId: 'job-swap-1' }).expect(201);
    const again = await authed().send({ jobId: 'job-swap-1' });
    expect(again.body.deduplicated).toBe(false);
    expect(queues.swap.add).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent requests with the same key into one replay', async () => {
    let release!: () => void;
    deadLetters.getDeadLetter.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(swapEntry);
        }),
    );
    const first = authed()
      .set('x-idempotency-key', 'op-concurrent')
      .send({ jobId: 'job-swap-1' })
      .then((r) => r);
    const second = authed()
      .set('x-idempotency-key', 'op-concurrent')
      .send({ jobId: 'job-swap-1' })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.body.deduplicated, b.body.deduplicated].sort()).toEqual([
      false,
      true,
    ]);
    expect(deadLetters.getDeadLetter).toHaveBeenCalledTimes(1);
    expect(queues.swap.add).toHaveBeenCalledTimes(1);
  });

  it('does not let one idempotency key replay a different job', async () => {
    await authed()
      .set('x-idempotency-key', 'op-shared')
      .send({ jobId: 'job-swap-1' })
      .expect(201);
    deadLetters.getDeadLetter.mockResolvedValue({
      ...swapEntry,
      jobId: 'job-swap-2',
    });
    const res = await authed()
      .set('x-idempotency-key', 'op-shared')
      .send({ jobId: 'job-swap-2' });
    expect(res.body.deduplicated).toBe(false);
    expect(res.body.replayed).toEqual(['job-swap-2']);
  });

  it('returns 404 with a stable code for an unknown job', async () => {
    deadLetters.getDeadLetter.mockResolvedValue(null);
    const res = await authed().send({ jobId: 'missing-job' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DLQ_REPLAY_NOT_FOUND');
  });

  it('fails closed with 503 when the DLQ store is down', async () => {
    deadLetters.getDeadLetters.mockRejectedValue(
      new DeadLetterStoreUnavailableError(new Error('ECONNREFUSED')),
    );
    const res = await authed().send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DLQ_REPLAY_DEPENDENCY_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(queues.swap.add).not.toHaveBeenCalled();
    expect(deadLetters.clearDeadLetter).not.toHaveBeenCalled();
    expect(dlqReplayOutcomes.snapshot().dependency_unavailable).toBe(1);
  });

  it('does not cache failures: a retry after an outage runs again', async () => {
    deadLetters.getDeadLetters.mockRejectedValueOnce(
      new DeadLetterStoreUnavailableError(new Error('down')),
    );
    await authed().set('x-idempotency-key', 'op-outage').send({}).expect(503);
    const retry = await authed().set('x-idempotency-key', 'op-outage').send({});
    expect(retry.status).toBe(201);
    expect(retry.body.deduplicated).toBe(false);
    expect(retry.body.replayed).toEqual(['job-swap-1']);
  });

  it('asks the store to fail closed rather than return empty', async () => {
    await authed().send({}).expect(201);
    expect(deadLetters.getDeadLetters).toHaveBeenCalledWith(
      undefined,
      500,
      true,
      { failClosed: true },
    );
  });
});
