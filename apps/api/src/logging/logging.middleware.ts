import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);
const SENSITIVE_BODY_KEYS = new Set(['password', 'token', 'secret', 'accessToken', 'refreshToken']);

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE_BODY_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.path === '/health') return next();

    const requestId = randomUUID();
    const start = Date.now();

    res.setHeader('X-Request-Id', requestId);
    (req as Request & { requestId: string }).requestId = requestId;

    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      this.logger.log(
        JSON.stringify({
          event: 'request',
          requestId,
          method: req.method,
          path: req.path,
          query: req.query,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          headers: redactHeaders(req.headers as Record<string, unknown>),
          body: redactBody(req.body),
        }),
      );
    } else {
      this.logger.log(`→ ${req.method} ${req.path} requestId=${requestId} ip=${req.ip}`);
    }

    res.on('finish', () => {
      const elapsed = Date.now() - start;
      if (isProd) {
        this.logger.log(
          JSON.stringify({ event: 'response', requestId, status: res.statusCode, elapsed }),
        );
      } else {
        this.logger.log(
          `← ${res.statusCode} ${req.method} ${req.path} ${elapsed}ms requestId=${requestId}`,
        );
      }
    });

    next();
  }
}
