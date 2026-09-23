import { CacheStampedeGuard, CacheError, CacheErrorCode } from './cache-stampede';

describe('CacheStampedeGuard', () => {
  let guard: CacheStampedeGuard;

  beforeEach(() => {
    guard = new CacheStampedeGuard();
  });

  afterEach(() => {
    guard.clear();
  });

  describe('single-flight coalescing', () => {
    it('coalesces concurrent misses for the same key into one upstream fetch', async () => {
      let fetches = 0;
      const loader = jest.fn(async () => {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 25));
        return 'value';
      });

      const results = await Promise.all(
        Array.from({ length: 25 }, () => guard.get('liquidity:usdc', loader)),
      );

      expect(fetches).toBe(1);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r === 'value')).toBe(true);
    });

    it('does not coalesce distinct keys', async () => {
      const loader = jest.fn(async (key: string) => key);
      const [a, b] = await Promise.all([
        guard.get('a', () => loader('a')),
        guard.get('b', () => loader('b')),
      ]);
      expect(a).toBe('a');
      expect(b).toBe('b');
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('allows a fresh fetch after the in-flight request settles', async () => {
      const loader = jest.fn(async () => 'v');
      await guard.get('k', loader);
      await guard.get('k', loader);
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('fail-closed behavior', () => {
    it('propagates loader failure to all coalesced callers with a stable error code', async () => {
      const loader = jest.fn(async () => {
        throw new Error('redis down');
      });

      const results = await Promise.allSettled([
        guard.get('k', loader),
        guard.get('k', loader),
        guard.get('k', loader),
      ]);

      expect(loader).toHaveBeenCalledTimes(1);
      for (const r of results) {
        expect(r.status).toBe('rejected');
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(CacheError);
          expect((r.reason as CacheError).code).toBe(CacheErrorCode.UPSTREAM_UNAVAILABLE);
        }
      }
    });

    it('does not serve stale data on dependency outage', async () => {
      const loader = jest.fn(async () => {
        throw new Error('rpc timeout');
      });
      await expect(guard.get('k', loader)).rejects.toBeInstanceOf(CacheError);
      await expect(guard.get('k', loader)).rejects.toBeInstanceOf(CacheError);
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('idempotency and correlation ids', () => {
    it('attaches a correlation id to errors', async () => {
      const loader = jest.fn(async () => {
        throw new Error('boom');
      });
      await expect(guard.get('k', loader, { correlationId: 'cid-1' })).rejects.toMatchObject({
        correlationId: 'cid-1',
      });
    });

    it('replayed requests after settle are idempotent', async () => {
      const loader = jest.fn(async () => 'v');
      const first = await guard.get('k', loader);
      const second = await guard.get('k', loader);
      expect(first).toBe(second);
    });
  });
});
