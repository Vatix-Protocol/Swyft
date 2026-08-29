# Rate Limiting

## Overview

The Swyft API enforces per-IP (and per-internal-key) rate limits using Redis
sliding-window counters, and exposes the caller's current limit status on
every response via standard `X-RateLimit-*` headers.

**Implementation:** `apps/api/src/rate-limit/rate-limit.middleware.ts`
**Tests:** `apps/api/src/rate-limit/rate-limit.middleware.spec.ts`

## Response Headers

These headers are set on **every** response except `/health`, whenever the
rate limiter is active (i.e. always — there is no separate on/off switch;
"limiting enabled" means the middleware is mounted, which it is globally):

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | The effective window limit (requests per minute) for the rule that governs this request. |
| `X-RateLimit-Remaining` | Requests remaining in the current 1-minute window. Never negative. |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets. |
| `Retry-After` | Seconds to wait before retrying. Only present on `429` responses. |

**Example:**
```bash
curl -i https://api.example.com/v1/pools

HTTP/1.1 200 OK
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 299
X-RateLimit-Reset: 1785000060
...
```

**Example, limit exceeded:**
```bash
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1785000060
Retry-After: 42

{"statusCode":429,"message":"Too many requests","error":"Too Many Requests"}
```

When multiple rules apply to a request (e.g. a global rule plus a stricter
per-endpoint rule), the headers reflect whichever rule is most restrictive —
the first exceeded rule, or otherwise the rule with the fewest requests
remaining.

## Rules

A global rule applies to every request. Certain endpoint groups carry an
additional, stricter rule layered on top:

| Group | Match | Public limit | Internal limit |
|---|---|---|---|
| Global | all requests | `RATE_LIMIT_PER_MINUTE` (300) | `INTERNAL_RATE_LIMIT_PER_MINUTE` (1200) |
| Candles | `GET /prices/:base/:quote/candles` | `CANDLE_RATE_LIMIT_PER_MINUTE` (60) | `INTERNAL_CANDLE_RATE_LIMIT_PER_MINUTE` (240) |
| Auth | `/auth/*` | `AUTH_RATE_LIMIT_PER_MINUTE` (10) | `INTERNAL_AUTH_RATE_LIMIT_PER_MINUTE` (60) |
| Transactions | `POST /transactions` | `TRANSACTION_RATE_LIMIT_PER_MINUTE` (20) | `INTERNAL_TRANSACTION_RATE_LIMIT_PER_MINUTE` (120) |
| Ticks | `GET /pools/:id/ticks` | `TICKS_RATE_LIMIT_PER_MINUTE` (30) | `INTERNAL_TICKS_RATE_LIMIT_PER_MINUTE` (120) |

"Internal" requests are those carrying a valid `x-internal-key` header
matching `INTERNAL_API_KEY`. All limits are configurable via environment
variables — see `apps/api/.env.example`.

## Behaviour When Redis Is Unavailable

The middleware uses lazy-connect and never blocks app startup on Redis. If
Redis is unreachable when a request comes in, the request is **allowed
through** (fail open) and the response still carries the standard headers,
computed from the configured limit for that route with `remaining=0` — so
clients get a consistent, machine-readable signal even in a degraded state.

## Identity

- **Internal requests** are keyed by their `x-internal-key` header value.
- **Public requests** are keyed by the first IP in `x-forwarded-for`, falling
  back to the socket's remote address.

## Related Files

- **Main implementation:** `apps/api/src/rate-limit/rate-limit.middleware.ts`
- **Module wiring:** `apps/api/src/rate-limit/rate-limit.module.ts` (mounted globally in `AppModule`)
- **Tests:** `apps/api/src/rate-limit/rate-limit.middleware.spec.ts`
- **Env vars:** `apps/api/.env.example`

---

*Last updated: 2026-08-29*
