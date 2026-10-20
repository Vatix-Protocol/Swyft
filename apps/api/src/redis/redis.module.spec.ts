import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';

import { RedisModule } from './redis.module';

/**
 * Captures the options object passed to the ioredis constructor so the
 * Redis client wiring can be asserted deterministically for every env
 * combination (issue #1224).
 */
const capturedOptions: Array<Record<string, unknown>> = [];

jest.mock('ioredis', () => {
  const mock = jest.fn(function Redis(
    this: unknown,
    options: Record<string, unknown>,
  ) {
    capturedOptions.push(options);
    this.options = options;
  });
  return { __esModule: true, default: mock };
});

const MockedRedis = Redis as unknown as jest.MockedClass<typeof Redis> & {
  mockClear: () => void;
};

function configWith(env: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => (key in env ? env[key] : undefined),
    getOrThrow: () => undefined as unknown as string,
  } as unknown as ConfigService;
}

async function buildModule(
  env: Record<string, unknown>,
): Promise<TestingModule> {
  capturedOptions.length = 0;
  MockedRedis.mockClear();

  const module = await Test.createTestingModule({
    imports: [RedisModule],
  })
    .overrideProvider(ConfigService)
    .useValue(configWith(env))
    .compile();

  return module;
}

describe('RedisModule (issue #1224)', () => {
  let module: TestingModule | null = null;

  afterEach(async () => {
    if (module) {
      await module.close().catch(() => {
        // Swallow close errors; the factory only constructs the client.
      });
      module = null;
    }
  });

  it('defaults to localhost:6379 with no password and no TLS when no env vars are set', async () => {
    module = await buildModule({});

    expect(capturedOptions).toEqual([
      {
        host: 'localhost',
        port: 6379,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('applies REDIS_PASSWORD only when it is set', async () => {
    module = await buildModule({ REDIS_PASSWORD: 's3cret' });

    expect(capturedOptions).toEqual([
      {
        host: 'localhost',
        port: 6379,
        password: 's3cret',
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('enables TLS only for the exact string REDIS_TLS=true', async () => {
    module = await buildModule({ REDIS_TLS: 'true' });

    expect(capturedOptions).toEqual([
      {
        host: 'localhost',
        port: 6379,
        tls: {},
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('does not enable TLS for REDIS_TLS=1 (or any non-"true" value)', async () => {
    module = await buildModule({ REDIS_TLS: '1' });

    expect(capturedOptions).toEqual([
      {
        host: 'localhost',
        port: 6379,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('resolves host, port and password from REDIS_URL before defaults', async () => {
    module = await buildModule({
      REDIS_URL: 'rediss://:url-password@redis.example.com:6380',
    });

    expect(capturedOptions).toEqual([
      {
        host: 'redis.example.com',
        port: 6380,
        password: 'url-password',
        tls: {},
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('derives plain-text TLS from a rediss:// URL even when REDIS_TLS is unset', async () => {
    module = await buildModule({
      REDIS_URL: 'redis://redis.example.com:6380',
      REDIS_TLS: 'true',
    });

    expect(capturedOptions).toEqual([
      {
        host: 'redis.example.com',
        port: 6380,
        tls: {},
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });

  it('keeps host/port defaults when REDIS_URL is unset even with REDIS_HOST set', async () => {
    module = await buildModule({
      REDIS_HOST: 'ignored-host',
      REDIS_PORT: 9999,
    });

    expect(capturedOptions).toEqual([
      {
        host: 'ignored-host',
        port: 9999,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      },
    ]);
  });
});
