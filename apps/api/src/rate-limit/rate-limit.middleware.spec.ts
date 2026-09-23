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

  it('exempts metrics scrapes', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use({ path: '/metrics' } as never, res as never, next);

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

  it('applies a dedicated rate limit for GET /pools/:id/ticks when Redis is unavailable', async () => {
    const middleware = new RateLimitMiddleware();
    const res = response();

    await middleware.use(
      {
        path: '/pools/abc123/ticks',
        method: 'GET',
        headers: {},
        ip: '127.0.0.1',
      } as never,
      res as never,
      next,
    );

    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
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

  it('fails closed with 503 when Redis is unavailable in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const middleware = new RateLimitMiddleware();
      const res = response();

      await middleware.use(
        {
          path: '/pools',
          originalUrl: '/pools',
          headers: {},
          ip: '127.0.0.1',
        } as never,
        res as never,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 503,
          error: 'Service Unavailable',
        }),
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('fails closed with 503 when a Redis command throws in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const middleware = new RateLimitMiddleware();
      (middleware as unknown as { redis: object }).redis = {
        incr: jest.fn().mockRejectedValue(new Error('connection lost')),
      };
      const res = response();

      await middleware.use(
        {
          path: '/pools',
          originalUrl: '/pools',
          headers: {},
          ip: '127.0.0.1',
        } as never,
        res as never,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('returns the standard ErrorResponse body on 429 with Retry-After', async () => {
    const middleware = new RateLimitMiddleware();
    (middleware as unknown as { redis: object }).redis = {
      incr: jest.fn().mockResolvedValue(301),
      expire: jest.fn(),
      ttl: jest.fn().mockResolvedValue(42),
    };
    const res = response();

    await middleware.use(
      {
        path: '/pools',
        originalUrl: '/v1/pools',
        method: 'GET',
        headers: {},
        ip: '203.0.113.10',
      } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        message: 'Too many requests',
        error: 'Too Many Requests',
        path: '/v1/pools',
        retryAfter: '42',
        timestamp: expect.any(String),
      }),
    );
  });
});
