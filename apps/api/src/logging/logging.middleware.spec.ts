import { LoggingMiddleware } from './logging.middleware';
import { RequestContext } from './request-context';

describe('LoggingMiddleware', () => {
  const next = jest.fn();

  const response = () => {
    const listeners: Record<string, () => void> = {};
    const res = {
      headers: new Map<string, string>(),
      setHeader: jest.fn((key: string, value: string) => {
        res.headers.set(key, value);
      }),
      on: jest.fn((event: string, cb: () => void) => {
        listeners[event] = cb;
      }),
      emitFinish: () => listeners['finish']?.(),
      statusCode: 200,
    };
    return res;
  };

  const request = (overrides: Record<string, unknown> = {}) => ({
    path: '/v1/pools',
    method: 'GET',
    ip: '127.0.0.1',
    query: {},
    headers: {},
    get: jest.fn(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips /health without generating a requestId', () => {
    const middleware = new LoggingMiddleware();
    const res = response();
    const req = request({ path: '/health' });

    middleware.use(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('sets X-Request-Id header and attaches requestId to the request', () => {
    const middleware = new LoggingMiddleware();
    const res = response();
    const req = request();

    middleware.use(req as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.any(String),
    );
    expect((req as { requestId?: string }).requestId).toEqual(
      expect.any(String),
    );
    expect(next).toHaveBeenCalled();
  });

  it('makes the requestId available via RequestContext for downstream code', () => {
    const middleware = new LoggingMiddleware();
    const res = response();
    const req = request();
    let seenDuringHandling: string | undefined;

    next.mockImplementationOnce(() => {
      seenDuringHandling = RequestContext.requestId;
    });

    middleware.use(req as never, res as never, next);

    expect(seenDuringHandling).toBeDefined();
    expect(seenDuringHandling).toBe((req as { requestId: string }).requestId);
    // Outside the middleware's scope the context must not leak.
    expect(RequestContext.requestId).toBeUndefined();
  });

  it('logs the response status and elapsed time on finish', () => {
    const middleware = new LoggingMiddleware();
    const res = response();
    const req = request();
    const logSpy = jest
      .spyOn(
        (middleware as unknown as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);

    middleware.use(req as never, res as never, next);
    res.statusCode = 204;
    res.emitFinish();

    const requestId = (req as { requestId: string }).requestId;
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`← 204 GET /v1/pools`),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`requestId=${requestId}`),
    );
  });

  it('redacts sensitive headers and body fields in production logs', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const middleware = new LoggingMiddleware();
    const res = response();
    const req = request({
      headers: {
        authorization: 'Bearer top-secret',
        'x-api-key': 'api-key-secret',
        'x-foo': 'visible',
      },
      body: {
        apiKey: 'body-secret',
        password: 'body-password',
        safeValue: 'visible',
      },
    });
    const logSpy = jest
      .spyOn(
        (middleware as unknown as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);

    middleware.use(req as never, res as never, next);
    res.emitFinish();

    const output = logSpy.mock.calls.map((args) => args[0]).join(' ');
    expect(output).toContain('"authorization":"[REDACTED]"');
    expect(output).toContain('"x-api-key":"[REDACTED]"');
    expect(output).toContain('"apiKey":"[REDACTED]"');
    expect(output).toContain('"password":"[REDACTED]"');
    expect(output).not.toContain('top-secret');
    expect(output).not.toContain('api-key-secret');
    expect(output).not.toContain('body-secret');
    expect(output).not.toContain('body-password');
    expect(output).toContain('"x-foo":"visible"');

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
