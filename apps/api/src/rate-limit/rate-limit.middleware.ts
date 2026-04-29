import {
  Injectable,
  NestMiddleware,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';

interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitHit extends RateLimitRule {
  remaining: number;
  resetSeconds: number;
  exceeded: boolean;
}

@Injectable()
export class RateLimitMiddleware
  implements NestMiddleware, OnModuleInit, OnModuleDestroy
{
  private redis: Redis | null = null;

  onModuleInit() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });

    this.redis.connect().catch(() => {
      this.redis = null;
    });
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.path === '/health') {
      next();
      return;
    }

    if (!this.redis) {
      this.setHeaders(res, this.publicRuleFor(req), 0, 0);
      next();
      return;
    }

    const rules = this.rulesFor(req);
    const identity = this.identityFor(req);
    let hits: RateLimitHit[];

    try {
      hits = await Promise.all(
        rules.map((rule) => this.hit(rule, identity, this.routeBucketFor(req))),
      );
    } catch {
      this.setHeaders(res, this.publicRuleFor(req), 0, 0);
      next();
      return;
    }
    const effective = this.effectiveHit(hits);

    this.setHeaders(
      res,
      effective,
      effective.remaining,
      effective.resetSeconds,
    );

    if (effective.exceeded) {
      res.setHeader('Retry-After', effective.resetSeconds.toString());
      res.status(429).json({
        statusCode: 429,
        message: 'Too many requests',
        error: 'Too Many Requests',
      });
      return;
    }

    next();
  }

  private rulesFor(req: Request): RateLimitRule[] {
    const internal = this.isInternalRequest(req);
    const globalLimit = internal
      ? this.envInt('INTERNAL_RATE_LIMIT_PER_MINUTE', 1200)
      : this.envInt('RATE_LIMIT_PER_MINUTE', 300);
    const endpointRule = this.endpointRuleFor(req, internal);

    return [
      {
        name: internal ? 'internal-global' : 'global',
        limit: globalLimit,
        windowSeconds: 60,
      },
      ...(endpointRule ? [endpointRule] : []),
    ];
  }

  private endpointRuleFor(
    req: Request,
    internal: boolean,
  ): RateLimitRule | null {
    if (/^\/prices\/[^/]+\/[^/]+\/candles\/?$/.test(req.path)) {
      return {
        name: internal ? 'internal-candles' : 'candles',
        limit: internal
          ? this.envInt('INTERNAL_CANDLE_RATE_LIMIT_PER_MINUTE', 240)
          : this.envInt('CANDLE_RATE_LIMIT_PER_MINUTE', 60),
        windowSeconds: 60,
      };
    }

    if (req.path.startsWith('/auth')) {
      return {
        name: internal ? 'internal-auth' : 'auth',
        limit: internal
          ? this.envInt('INTERNAL_AUTH_RATE_LIMIT_PER_MINUTE', 60)
          : this.envInt('AUTH_RATE_LIMIT_PER_MINUTE', 10),
        windowSeconds: 60,
      };
    }

    return null;
  }

  private async hit(
    rule: RateLimitRule,
    identity: string,
    routeBucket: string,
  ): Promise<RateLimitHit> {
    const key = `rate-limit:${rule.name}:${identity}:${routeBucket}`;
    const total = await this.redis!.incr(key);

    if (total === 1) {
      await this.redis!.expire(key, rule.windowSeconds);
    }

    const ttl = await this.redis!.ttl(key);
    const resetSeconds = ttl > 0 ? ttl : rule.windowSeconds;

    return {
      ...rule,
      remaining: Math.max(rule.limit - total, 0),
      resetSeconds,
      exceeded: total > rule.limit,
    };
  }

  private effectiveHit(hits: RateLimitHit[]): RateLimitHit {
    const exceeded = hits.find((hit) => hit.exceeded);
    if (exceeded) return exceeded;

    return hits.reduce((lowest, hit) =>
      hit.remaining < lowest.remaining ? hit : lowest,
    );
  }

  private setHeaders(
    res: Response,
    rule: RateLimitRule,
    remaining: number,
    resetSeconds: number,
  ) {
    res.setHeader('X-RateLimit-Limit', rule.limit.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader(
      'X-RateLimit-Reset',
      Math.ceil(Date.now() / 1000 + resetSeconds).toString(),
    );
  }

  private publicRuleFor(req: Request): RateLimitRule {
    return (
      this.endpointRuleFor(req, false) ?? {
        name: 'global',
        limit: this.envInt('RATE_LIMIT_PER_MINUTE', 300),
        windowSeconds: 60,
      }
    );
  }

  private routeBucketFor(req: Request): string {
    if (/^\/prices\/[^/]+\/[^/]+\/candles\/?$/.test(req.path)) {
      return 'prices-candles';
    }
    if (req.path.startsWith('/auth')) return 'auth';
    return 'global';
  }

  private identityFor(req: Request): string {
    if (this.isInternalRequest(req)) {
      return `internal:${req.headers['x-internal-key']}`;
    }

    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }

    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }

  private isInternalRequest(req: Request): boolean {
    const expected = process.env.INTERNAL_API_KEY;
    return Boolean(expected && req.headers['x-internal-key'] === expected);
  }

  private envInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
