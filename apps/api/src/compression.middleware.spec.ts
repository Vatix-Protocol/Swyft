import { Controller, Get, Header, INestApplication, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Response } from 'express';
import request from 'supertest';
import { get as httpGet, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import { brotliDecompressSync, gunzipSync } from 'zlib';
import {
  COMPRESSION_DEFAULTS,
  CompressionMiddleware,
  compressionOutcomes,
  isCompressible,
  negotiateEncoding,
  resolveCompressionConfig,
} from './compression.middleware';

interface MockResponse {
  statusCode: number;
  headersSent: boolean;
  write: jest.Mock;
  end: jest.Mock;
  getHeader: jest.Mock;
  setHeader: jest.Mock;
  removeHeader: jest.Mock;
  vary: jest.Mock;
}

function response(contentType: string, contentEncoding?: string) {
  const headers = new Map<string, string>();
  headers.set('Content-Type', contentType);
  if (contentEncoding) headers.set('Content-Encoding', contentEncoding);

  const chunks: Buffer[] = [];
  const res: MockResponse = {
    statusCode: 200,
    headersSent: false,
    write: jest.fn((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }),
    end: jest.fn((chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      return res;
    }),
    getHeader: jest.fn((name: string) => headers.get(name)),
    setHeader: jest.fn((name: string, value: string) =>
      headers.set(name, value),
    ),
    removeHeader: jest.fn((name: string) => headers.delete(name)),
    vary: jest.fn(),
  };

  return { res, headers, chunks };
}

describe('CompressionMiddleware', () => {
  const body = Buffer.alloc(2048, 'a');

  it('leaves already-compressed responses unchanged', () => {
    const { res, headers, chunks } = response('application/json', 'gzip');
    const next = jest.fn(() => res.end(body));

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'br' }, path: '/v1/pools' } as never,
      res as never,
      next,
    );

    expect(Buffer.concat(chunks)).toEqual(body);
    expect(headers.get('Content-Encoding')).toBe('gzip');
  });

  it('does not compress binary responses', () => {
    const { res, headers, chunks } = response('application/octet-stream');
    const next = jest.fn(() => res.end(body));

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'gzip' }, path: '/download' } as never,
      res as never,
      next,
    );

    expect(Buffer.concat(chunks)).toEqual(body);
    expect(headers.has('Content-Encoding')).toBe(false);
  });

  it('does not intercept health responses', () => {
    const { res } = response('application/json');
    const originalEnd = res.end;
    const next = jest.fn();

    new CompressionMiddleware().use(
      { headers: { 'accept-encoding': 'gzip' }, path: '/health' } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.end).toBe(originalEnd);
  });

  it('never intercepts auth responses (BREACH)', () => {
    const { res } = response('application/json');
    const originalEnd = res.end;

    for (const path of ['/v1/auth/verify', '/auth/nonce']) {
      new CompressionMiddleware().use(
        { headers: { 'accept-encoding': 'gzip' }, path } as never,
        res as never,
        jest.fn(),
      );
      expect(res.end).toBe(originalEnd);
    }
  });

  it('is a pass-through when the kill switch is off', () => {
    const { res } = response('application/json');
    const originalEnd = res.end;

    new CompressionMiddleware({ ...COMPRESSION_DEFAULTS, enabled: false }).use(
      { headers: { 'accept-encoding': 'gzip' }, path: '/v1/pools' } as never,
      res as never,
      jest.fn(),
    );

    expect(res.end).toBe(originalEnd);
  });
});

describe('resolveCompressionConfig', () => {
  it('uses safe defaults when unset', () => {
    expect(resolveCompressionConfig({})).toEqual(COMPRESSION_DEFAULTS);
  });

  it.each(['abc', '0', '10', '-1', '6.5', 'NaN'])(
    'falls back to the default level for invalid COMPRESSION_LEVEL=%s',
    (value) => {
      expect(resolveCompressionConfig({ COMPRESSION_LEVEL: value }).level).toBe(
        COMPRESSION_DEFAULTS.level,
      );
    },
  );

  it('accepts a valid level and kill switch', () => {
    const config = resolveCompressionConfig({
      COMPRESSION_LEVEL: '9',
      COMPRESSION_ENABLED: 'FALSE',
    });
    expect(config.level).toBe(9);
    expect(config.enabled).toBe(false);
  });

  it('only adds exclusions; defaults cannot be removed', () => {
    const config = resolveCompressionConfig({
      COMPRESSION_EXCLUDED_PATHS: '/v1/admin, not-a-path ,',
    });
    expect(config.excludedPathPrefixes).toEqual([
      ...COMPRESSION_DEFAULTS.excludedPathPrefixes,
      '/v1/admin',
    ]);
  });

  it('rejects an out-of-range buffer cap', () => {
    expect(
      resolveCompressionConfig({ COMPRESSION_MAX_BUFFER_BYTES: '1' })
        .maxBufferBytes,
    ).toBe(COMPRESSION_DEFAULTS.maxBufferBytes);
  });
});

describe('negotiateEncoding', () => {
  it.each([
    ['gzip, deflate, br', 'br'],
    ['gzip', 'gzip'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0.2, gzip;q=0.8', 'gzip'],
    ['gzip;q=0, br;q=0', null],
    ['identity', null],
    ['*', 'br'],
    ['*;q=0', null],
    ['', null],
    [undefined, null],
    [['gzip', 'br;q=0'], 'gzip'],
    ['bro, gzipx', null],
  ])('%j → %s', (header, expected) => {
    expect(negotiateEncoding(header as never)).toBe(expected);
  });

  it('bounds work on an adversarial header', () => {
    const header = 'x;q=1,'.repeat(100_000) + 'gzip';
    expect(negotiateEncoding(header)).toBeNull();
  });
});

describe('isCompressible', () => {
  it.each([
    ['application/json; charset=utf-8', true],
    ['application/problem+json', true],
    ['text/html', true],
    ['text/event-stream', false],
    ['image/png', false],
    [undefined, false],
  ])('%s → %s', (type, expected) => {
    expect(isCompressible(type)).toBe(expected);
  });
});

// ── HTTP round-trip through a real Nest/Express stack ────────────────────────

const LARGE = { items: Array.from({ length: 200 }, (_, i) => ({ id: i })) };

@Controller()
class FixtureController {
  @Get('large')
  large() {
    return LARGE;
  }

  @Get('small')
  small() {
    return { ok: true };
  }

  @Get('no-transform')
  @Header('Cache-Control', 'no-transform')
  noTransform() {
    return LARGE;
  }

  @Get('empty')
  @Header('Content-Type', 'application/json')
  empty(@Res() res: Response) {
    res.status(204).end();
  }

  @Get('chunked')
  chunked(@Res() res: Response) {
    res.type('application/json');
    const json = JSON.stringify(LARGE);
    res.write(json.slice(0, 500));
    res.write(json.slice(500));
    res.end();
  }
}

describe('CompressionMiddleware — HTTP round-trip', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  async function build(config = COMPRESSION_DEFAULTS) {
    const module = await Test.createTestingModule({
      controllers: [FixtureController],
    }).compile();
    const instance = module.createNestApplication({ logger: false });
    const middleware = new CompressionMiddleware(config);
    instance.use(middleware.use.bind(middleware));
    await instance.init();
    return instance;
  }

  // Raw bytes: supertest transparently decodes gzip/br, which would hide
  // what actually went over the wire.
  function raw(
    path: string,
    acceptEncoding: string,
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
    const { port } = (server as Server).address() as AddressInfo;
    return new Promise((resolve, reject) => {
      httpGet(
        { port, path, headers: { 'Accept-Encoding': acceptEncoding } },
        (res) => {
          const data: Buffer[] = [];
          res.on('data', (c: Buffer) => data.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(data),
            }),
          );
        },
      ).on('error', reject);
    });
  }

  beforeAll(async () => {
    app = await build();
    server = app.getHttpServer();
    await new Promise<void>((resolve) => (server as Server).listen(0, resolve));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => compressionOutcomes.reset());

  it('brotli-compresses large JSON with correct headers', async () => {
    const res = await raw('/large', 'gzip, br');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['vary']).toMatch(/Accept-Encoding/i);
    const decoded = brotliDecompressSync(res.body);
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
    expect(JSON.parse(decoded.toString())).toEqual(LARGE);
    expect(compressionOutcomes.snapshot().compressed_br).toBe(1);
  });

  it('gzip-compresses when brotli is refused with q=0', async () => {
    const res = await raw('/large', 'br;q=0, gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(res.body).toString())).toEqual(LARGE);
  });

  it('compresses bodies written in several chunks', async () => {
    const res = await raw('/chunked', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(res.body).toString())).toEqual(LARGE);
  });

  it('sends small bodies uncompressed', async () => {
    const res = await request(server)
      .get('/small')
      .set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
  });

  it('honours Cache-Control: no-transform', async () => {
    const res = await request(server)
      .get('/no-transform')
      .set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual(LARGE);
  });

  it('leaves 204 responses alone', async () => {
    const res = await request(server)
      .get('/empty')
      .set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(204);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('falls back to the identity body when zlib fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('zlib') as typeof import('zlib');
    const spy = jest
      .spyOn(zlib, 'gzip')
      .mockImplementation(((_b: unknown, _o: unknown, cb: (e: Error) => void) =>
        cb(new Error('boom'))) as never);
    try {
      const res = await raw('/large', 'gzip');
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(JSON.parse(res.body.toString())).toEqual(LARGE);
      expect(compressionOutcomes.snapshot().error_fallback).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('streams bodies over the buffer cap uncompressed', async () => {
    const capped = await build({
      ...COMPRESSION_DEFAULTS,
      maxBufferBytes: 1024,
    });
    try {
      const res = await request(capped.getHttpServer())
        .get('/chunked')
        .set('Accept-Encoding', 'gzip');
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body).toEqual(LARGE);
      expect(compressionOutcomes.snapshot().skipped_oversize).toBe(1);
    } finally {
      await capped.close();
    }
  });
});
