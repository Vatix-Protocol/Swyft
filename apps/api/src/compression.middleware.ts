import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { brotliCompress, gzip, constants as zlibConstants } from 'zlib';
import { BoundedCounter } from './observability/bounded-counter';

/**
 * Response compression with safe defaults (#1028).
 *
 * Invariants (see docs/COMPRESSION.md):
 *  - Kill switch: `COMPRESSION_ENABLED=false` turns the middleware into a
 *    pass-through without a redeploy.
 *  - Config fails safe: an invalid level/threshold/cap falls back to the
 *    documented default instead of crashing zlib on the first response.
 *  - Bounded memory: bodies larger than `COMPRESSION_MAX_BUFFER_BYTES` are
 *    streamed through uncompressed rather than buffered without limit.
 *  - Never breaks a response: a compression error sends the original body
 *    uncompressed with its original headers.
 *  - BREACH: paths that return secrets (auth tokens) are never compressed,
 *    and handlers can opt out with `Cache-Control: no-transform`.
 *  - Streaming (SSE), WebSocket upgrades, HEAD and bodiless statuses are
 *    passed through untouched.
 *  - Metrics labels are a fixed enum; nothing request-derived is recorded.
 */

export interface CompressionConfig {
  enabled: boolean;
  /** gzip level 1-9; brotli quality is derived from it (capped at 11). */
  level: number;
  /** Bodies smaller than this are sent uncompressed. */
  minBytes: number;
  /** Bodies larger than this are streamed uncompressed (memory bound). */
  maxBufferBytes: number;
  /** Path prefixes that are never compressed (health, auth tokens). */
  excludedPathPrefixes: string[];
}

export const COMPRESSION_DEFAULTS: CompressionConfig = {
  enabled: true,
  level: 6,
  minBytes: 1024,
  maxBufferBytes: 5 * 1024 * 1024,
  excludedPathPrefixes: ['/health', '/auth', '/v1/auth'],
};

type Env = Record<string, string | undefined>;

function intInRange(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function resolveCompressionConfig(
  env: Env = process.env,
): CompressionConfig {
  const excluded = env.COMPRESSION_EXCLUDED_PATHS;
  return {
    enabled: env.COMPRESSION_ENABLED?.trim().toLowerCase() !== 'false',
    level: intInRange(env.COMPRESSION_LEVEL, 1, 9, COMPRESSION_DEFAULTS.level),
    minBytes: intInRange(
      env.COMPRESSION_MIN_BYTES,
      0,
      COMPRESSION_DEFAULTS.maxBufferBytes,
      COMPRESSION_DEFAULTS.minBytes,
    ),
    maxBufferBytes: intInRange(
      env.COMPRESSION_MAX_BUFFER_BYTES,
      1024,
      64 * 1024 * 1024,
      COMPRESSION_DEFAULTS.maxBufferBytes,
    ),
    // Extra prefixes add to the defaults; they can never remove /health or
    // the auth paths from the exclusion list.
    excludedPathPrefixes: [
      ...COMPRESSION_DEFAULTS.excludedPathPrefixes,
      ...(excluded ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.startsWith('/')),
    ],
  };
}

export type CompressionEncoding = 'br' | 'gzip';

/**
 * Picks an encoding from Accept-Encoding, honouring q-values (`q=0` means
 * "not acceptable"). Brotli wins ties. Returns null when neither is allowed.
 */
export function negotiateEncoding(
  header: string | string[] | undefined,
): CompressionEncoding | null {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  // Bound the work an adversarial header can cause.
  const entries = raw.slice(0, 1024).split(',', 32);
  const q: Record<string, number> = {};
  for (const entry of entries) {
    const [name, ...params] = entry.trim().toLowerCase().split(';');
    if (!name) continue;
    let weight = 1;
    for (const param of params) {
      const [k, v] = param.trim().split('=');
      if (k === 'q') {
        const parsed = Number(v);
        weight = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
      }
    }
    q[name] = weight;
  }
  const weightOf = (name: CompressionEncoding) => q[name] ?? q['*'] ?? 0;
  const br = weightOf('br');
  const gz = weightOf('gzip');
  if (br <= 0 && gz <= 0) return null;
  return br >= gz ? 'br' : 'gzip';
}

export function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  // Server-sent events must stream; buffering them would stall the client.
  if (type === 'text/event-stream') return false;
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type.endsWith('+json') ||
    type === 'application/javascript' ||
    type === 'application/xml' ||
    type.endsWith('+xml') ||
    type === 'image/svg+xml'
  );
}

export type CompressionOutcome =
  | 'compressed_br'
  | 'compressed_gzip'
  | 'skipped_disabled'
  | 'skipped_excluded'
  | 'skipped_not_accepted'
  | 'skipped_small'
  | 'skipped_type'
  | 'skipped_encoded'
  | 'skipped_no_transform'
  | 'skipped_no_body'
  | 'skipped_oversize'
  | 'error_fallback';

export const compressionOutcomes = new BoundedCounter<CompressionOutcome>(
  'http_compression_outcomes',
  [
    'compressed_br',
    'compressed_gzip',
    'skipped_disabled',
    'skipped_excluded',
    'skipped_not_accepted',
    'skipped_small',
    'skipped_type',
    'skipped_encoded',
    'skipped_no_transform',
    'skipped_no_body',
    'skipped_oversize',
    'error_fallback',
  ],
);

function headerString(value: unknown): string | undefined {
  if (Array.isArray(value)) return headerString(value[0]);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function toBuffer(chunk: unknown, encoding?: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(
    String(chunk),
    typeof encoding === 'string' ? (encoding as BufferEncoding) : undefined,
  );
}

function compress(
  body: Buffer,
  encoding: CompressionEncoding,
  level: number,
  done: (err: Error | null, out?: Buffer) => void,
): void {
  if (encoding === 'br') {
    brotliCompress(
      body,
      {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(level, 11),
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      },
      done,
    );
  } else {
    gzip(body, { level }, done);
  }
}

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CompressionMiddleware.name);

  constructor(
    private readonly config: CompressionConfig = resolveCompressionConfig(),
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!this.config.enabled) {
      compressionOutcomes.inc('skipped_disabled');
      return next();
    }

    // Skip WebSocket upgrades and bodiless HEAD responses.
    if (req.headers.upgrade === 'websocket' || req.method === 'HEAD') {
      return next();
    }

    const path = req.path ?? '';
    if (
      this.config.excludedPathPrefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
    ) {
      compressionOutcomes.inc('skipped_excluded');
      return next();
    }

    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    if (!encoding) {
      compressionOutcomes.inc('skipped_not_accepted');
      return next();
    }

    const originalWrite = res.write.bind(res) as (
      ...args: unknown[]
    ) => boolean;
    const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    const chunks: Buffer[] = [];
    let buffered = 0;
    let passthrough = false;

    const restore = () => {
      res.write = originalWrite as Response['write'];
      res.end = originalEnd as Response['end'];
    };

    // Once the body outgrows the buffer cap, flush what we have and stream
    // the rest through unmodified so memory stays bounded.
    const switchToPassthrough = () => {
      passthrough = true;
      compressionOutcomes.inc('skipped_oversize');
      restore();
      if (chunks.length > 0) originalWrite(Buffer.concat(chunks));
      chunks.length = 0;
    };

    res.write = ((chunk: unknown, encodingArg?: unknown, cb?: unknown) => {
      if (passthrough) return originalWrite(chunk, encodingArg, cb);
      const buf = toBuffer(chunk, encodingArg);
      chunks.push(buf);
      buffered += buf.length;
      if (buffered > this.config.maxBufferBytes) {
        switchToPassthrough();
      }
      const callback = typeof encodingArg === 'function' ? encodingArg : cb;
      if (typeof callback === 'function') process.nextTick(callback);
      return true;
    }) as Response['write'];

    res.end = ((chunk?: unknown, encodingArg?: unknown, cb?: unknown) => {
      if (passthrough) return originalEnd(chunk, encodingArg, cb);
      if (
        chunk !== undefined &&
        chunk !== null &&
        typeof chunk !== 'function'
      ) {
        chunks.push(
          toBuffer(
            chunk,
            typeof encodingArg === 'function' ? undefined : encodingArg,
          ),
        );
      }
      const body = Buffer.concat(chunks);
      restore();

      const skip = this.skipReason(res, body);
      if (skip) {
        compressionOutcomes.inc(skip);
        originalEnd(body);
        return res;
      }

      compress(body, encoding, this.config.level, (err, out) => {
        if (err || !out) {
          // Fail safe: the client still gets the full, uncompressed body.
          compressionOutcomes.inc('error_fallback');
          this.logger.warn(
            `compression failed, sending identity encoding: ${err?.message ?? 'no output'}`,
          );
          originalEnd(body);
          return;
        }
        compressionOutcomes.inc(
          encoding === 'br' ? 'compressed_br' : 'compressed_gzip',
        );
        if (!res.headersSent) {
          res.vary('Accept-Encoding');
          res.setHeader('Content-Encoding', encoding);
          res.setHeader('Content-Length', out.length);
        }
        originalEnd(out);
      });

      return res;
    }) as Response['end'];

    next();
  }

  private skipReason(res: Response, body: Buffer): CompressionOutcome | null {
    const status = res.statusCode;
    if (
      body.length === 0 ||
      status === 204 ||
      status === 304 ||
      (typeof status === 'number' && status < 200)
    ) {
      return 'skipped_no_body';
    }
    if (res.headersSent) return 'skipped_encoded';
    const contentEncoding = headerString(res.getHeader('Content-Encoding'));
    if (contentEncoding && contentEncoding !== 'identity') {
      return 'skipped_encoded';
    }
    const cacheControl = headerString(res.getHeader('Cache-Control'));
    if (cacheControl && /(^|,)\s*no-transform\s*(,|$)/i.test(cacheControl)) {
      return 'skipped_no_transform';
    }
    if (!isCompressible(headerString(res.getHeader('Content-Type')))) {
      return 'skipped_type';
    }
    if (body.length < this.config.minBytes) return 'skipped_small';
    return null;
  }
}
