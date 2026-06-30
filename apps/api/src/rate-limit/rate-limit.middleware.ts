import {
  Injectable,
  NestMiddleware,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';

/** A named rate-limit rule that defines a sliding-window counter. */
interface RateLimitRule {
  /** Human-readable label used as part of the Redis key (e.g. `"global"`, `"candles"`). */
  name: string;
  /** Maximum number of requests allowed within `windowSeconds`. */
  limit: number;
  /** Length of the sliding window in seconds. */
  windowSeconds: number;
}

/** The result of evaluating a single {@link RateLimitRule} for one request. */
interface RateLimitHit extends RateLimitRule {
  /** Requests remaining in the current window. Never negative. */
  remaining: number;
  /** Seconds until the window resets (sourced from the Redis TTL). */
  resetSeconds: number;
  /** `true` when the counter has exceeded `limit` for this window. */
  exceeded: boolean;
}

/**
 * NestJS middleware that enforces per-IP (and per-internal-key) rate limits
 * using Redis sliding-window counters.
 *
 * **Behaviour when Redis is unavailable:** all requests are allowed through and
 * rate-limit headers are set to reflect the configured limits with `remaining=0`.
 *
 * **Health-check bypass:** requests to `/health` are always passed through
 * without touching Redis or setting headers.
 *
 * ### Environment variables
 * | Variable | Default | Description |
 * |---|---|---|
 * | `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
 * | `RATE_LIMIT_PER_MINUTE` | `300` | Global limit for public requests |
 * | `INTERNAL_RATE_LIMIT_PER_MINUTE` | `1200` | Global limit for internal requests |
 * | `CANDLE_RATE_LIMIT_PER_MINUTE` | `60` | Per-minute limit for candle endpoints (public) |
 * | `INTERNAL_CANDLE_RATE_LIMIT_PER_MINUTE` | `240` | Per-minute limit for candle endpoints (internal) |
 * | `AUTH_RATE_LIMIT_PER_MINUTE` | `10` | Per-minute limit for auth endpoints (public) |
 * | `INTERNAL_AUTH_RATE_LIMIT_PER_MINUTE` | `60` | Per-minute limit for auth endpoints (internal) |
 * | `TRANSACTION_RATE_LIMIT_PER_MINUTE` | `20` | Per-minute limit for POST /transactions (public) |
 * | `INTERNAL_TRANSACTION_RATE_LIMIT_PER_MINUTE` | `120` | Per-minute limit for POST /transactions (internal) |
 * | `INTERNAL_API_KEY` | _(unset)_ | Shared secret sent via `x-internal-key` header |
 */
@Injectable()
export class RateLimitMiddleware
  implements NestMiddleware, OnModuleInit, OnModuleDestroy
{
  private redis: Redis | null = null;

  /**
   * Initialises the Redis connection with lazy-connect so the application
   * starts even when Redis is temporarily unavailable.
   */
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

  /**
   * Gracefully closes the Redis connection when the module is torn down.
   */
  async onModuleDestroy() {
    await this.redis?.quit();
  }

  /**
   * Express middleware entry point.
   *
   * Evaluates all applicable rate-limit rules for the incoming request and
   * either calls `next()` (request allowed) or responds with HTTP 429
   * (request blocked).
   *
   * Response headers set on every non-health request:
   * - `X-RateLimit-Limit` — the effective window limit
   * - `X-RateLimit-Remaining` — requests remaining in the current window
   * - `X-RateLimit-Reset` — Unix timestamp (seconds) when the window resets
   * - `Retry-After` — seconds to wait before retrying (only on 429 responses)
   *
   * @param req - Incoming Express request
   * @param res - Outgoing Express response
   * @param next - Express next-function; called when the request is allowed
   */
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

  /**
   * Returns the ordered list of {@link RateLimitRule}s that apply to `req`.
   *
   * Every request is subject to a global rule. Certain endpoint groups
   * (candles, auth) additionally carry a stricter per-endpoint rule.
   *
   * @param req - Incoming Express request
   * @returns One or two rules; the global rule is always first.
   */
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

  /**
   * Returns an additional per-endpoint {@link RateLimitRule} when the request
   * targets a rate-limited endpoint group, or `null` otherwise.
   *
   * @param req - Incoming Express request
   * @param internal - Whether the request carries a valid internal API key
   * @returns A stricter rule for the matched endpoint group, or `null`
   */
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

    if (req.path === '/transactions' && req.method === 'POST') {
      return {
        name: internal ? 'internal-transactions' : 'transactions',
        limit: internal
          ? this.envInt('INTERNAL_TRANSACTION_RATE_LIMIT_PER_MINUTE', 120)
          : this.envInt('TRANSACTION_RATE_LIMIT_PER_MINUTE', 20),
        windowSeconds: 60,
      };
    }

    return null;
  }

  /**
   * Increments the Redis counter for `rule` + `identity` + `routeBucket` and
   * returns the resulting {@link RateLimitHit}.
   *
   * Uses `INCR` + `EXPIRE` (set only on first increment) so the window is
   * anchored to the first request rather than a fixed clock boundary.
   *
   * @param rule - The rate-limit rule to evaluate
   * @param identity - Caller identity string (IP address or internal key)
   * @param routeBucket - Coarse route group used to namespace the Redis key
   * @returns The hit result including remaining count and reset time
   */
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

  /**
   * Selects the most restrictive hit from a list: the first exceeded rule if
   * any, otherwise the rule with the fewest remaining requests.
   *
   * @param hits - All evaluated hits for the current request
   * @returns The single hit that should govern the response headers and status
   */
  private effectiveHit(hits: RateLimitHit[]): RateLimitHit {
    const exceeded = hits.find((hit) => hit.exceeded);
    if (exceeded) return exceeded;

    return hits.reduce((lowest, hit) =>
      hit.remaining < lowest.remaining ? hit : lowest,
    );
  }

  /**
   * Writes the standard rate-limit response headers onto `res`.
   *
   * @param res - Express response object
   * @param rule - The rule whose `limit` is written to `X-RateLimit-Limit`
   * @param remaining - Value for `X-RateLimit-Remaining`
   * @param resetSeconds - Seconds from now until the window resets
   */
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

  /**
   * Returns the public (non-internal) rule that best describes `req`, used as
   * a fallback when Redis is unavailable.
   *
   * @param req - Incoming Express request
   * @returns The most specific public rule for the request path
   */
  private publicRuleFor(req: Request): RateLimitRule {
    return (
      this.endpointRuleFor(req, false) ?? {
        name: 'global',
        limit: this.envInt('RATE_LIMIT_PER_MINUTE', 300),
        windowSeconds: 60,
      }
    );
  }

  /**
   * Maps a request path to a coarse bucket string used to namespace Redis keys.
   *
   * @param req - Incoming Express request
   * @returns A short bucket label such as `"prices-candles"`, `"auth"`, or `"global"`
   */
  private routeBucketFor(req: Request): string {
    if (/^\/prices\/[^/]+\/[^/]+\/candles\/?$/.test(req.path)) {
      return 'prices-candles';
    }
    if (req.path.startsWith('/auth')) return 'auth';
    if (req.path === '/transactions') return 'transactions';
    return 'global';
  }

  /**
   * Derives a stable identity string for the caller.
   *
   * Internal requests are identified by their `x-internal-key` header value.
   * Public requests use the first IP in `x-forwarded-for`, falling back to
   * `req.ip` and finally `req.socket.remoteAddress`.
   *
   * @param req - Incoming Express request
   * @returns A string that uniquely identifies the caller for rate-limiting purposes
   */
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

  /**
   * Returns `true` when the request carries the correct `x-internal-key`
   * header matching the `INTERNAL_API_KEY` environment variable.
   *
   * @param req - Incoming Express request
   * @returns `true` if the request is authenticated as an internal caller
   */
  private isInternalRequest(req: Request): boolean {
    const expected = process.env.INTERNAL_API_KEY;
    return Boolean(expected && req.headers['x-internal-key'] === expected);
  }

  /**
   * Parses a positive integer from an environment variable, returning
   * `fallback` when the variable is absent, non-numeric, or non-positive.
   *
   * @param name - Environment variable name
   * @param fallback - Value to use when the variable is missing or invalid
   * @returns The parsed integer or `fallback`
   */
  private envInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
