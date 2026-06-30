import { RateLimitMiddleware } from './rate-limit.middleware';

describe('RateLimitMiddleware', () => {
  const next = jest.fn();
  const response = () => {
    const res = {
      headers: new Map<string, string>(),
      setHeader: jest.fn((key: string, value: string) => {
        res.headers.set(key, value);
      }),
      status: jest.fn(() => res),
      json: jest.fn(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exempts health checks', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use({ path: '/health' } as never, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('adds rate limit headers when Redis is unavailable', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use(
      {
        path: '/prices/XLM/USDC/candles',
        headers: {},
        ip: '127.0.0.1',
      } as never,
      res as never,
      next,
    );

    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.has('X-RateLimit-Reset')).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('applies transaction rate limit headers for POST /transactions when Redis is unavailable', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use(
      {
        path: '/transactions',
        method: 'POST',
        headers: {},
        ip: '127.0.0.1',
      } as never,
      res as never,
      next,
    );

    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.has('X-RateLimit-Reset')).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('does not apply transaction rule for GET /transactions', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use(
      {
        path: '/transactions',
        method: 'GET',
        headers: {},
        ip: '127.0.0.1',
      } as never,
      res as never,
      next,
    );

    // Falls through to global limit (300), not transactions limit (20)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('300');
    expect(next).toHaveBeenCalled();
  });
});
