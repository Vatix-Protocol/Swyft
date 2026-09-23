# Pools Ticks Endpoint Implementation

## Overview

This implementation provides the `GET /pools/:id/ticks` endpoint that returns active tick data for a pool, used by the frontend to render liquidity depth charts on the LP management interface.

## Endpoint Details

### URL

```
GET /pools/:id/ticks
```

### Parameters

- **id** (path parameter): Pool ID (cuid or contract address)
- **lowerTick** (query parameter, optional): Filter ticks with tickIndex >= lowerTick
- **upperTick** (query parameter, optional): Filter ticks with tickIndex <= upperTick
- **limit** (query parameter, optional): Maximum number of ticks to return. Defaults to `1000`, hard-capped at `5000`. Values outside `1..5000` are rejected with `400`.
- **cursor** (query parameter, optional): Opaque pagination cursor returned as `nextCursor` from a previous response. When supplied, `lowerTick`/`upperTick` must match the range the cursor was issued for.

### Response Format

```json
{
  "data": [
    {
      "tickIndex": -276324,
      "liquidityNet": "1000000000000000000",
      "liquidityGross": "1000000000000000000",
      "feeGrowthOutside0X128": "0",
      "feeGrowthOutside1X128": "0"
    }
  ],
  "nextCursor": "eyJ0aWNrSW5kZXgiOi0yNzYzMjR9",
  "hasMore": false
}
```

- `data`: array of ticks in ascending `tickIndex` order (empty array if no ticks).
- `nextCursor`: opaque cursor to pass back as `cursor` for the next page, or `null` when the last page has been reached.
- `hasMore`: `true` when additional ticks exist beyond the returned page.

### Status Codes

- **200**: Success - returns a page of ticks (empty `data` array if no ticks)
- **400**: Bad Request - invalid tick range (`lowerTick > upperTick`), invalid `limit`, or malformed/expired `cursor`
- **401**: Unauthorized - missing or invalid credentials
- **403**: Forbidden - authenticated caller lacks the `pools:read` scope
- **404**: Not Found - pool does not exist
- **429**: Too Many Requests - per-caller rate limit exceeded
- **503**: Service Unavailable - dependency (DB/Redis) outage on a fail-closed path

### Error Envelope

All non-2xx responses use a stable error envelope with a machine-readable `code` and a `correlationId` for support/observability:

```json
{
  "statusCode": 400,
  "code": "TICKS_INVALID_RANGE",
  "message": "lowerTick must be less than or equal to upperTick",
  "correlationId": "01HZ8Q2V6Y9K3M4N5P6Q7R8S9T"
}
```

Stable error codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `TICKS_INVALID_RANGE` | 400 | `lowerTick > upperTick` |
| `TICKS_INVALID_LIMIT` | 400 | `limit` outside `1..5000` |
| `TICKS_INVALID_CURSOR` | 400 | Malformed, tampered, or expired cursor |
| `TICKS_UNAUTHENTICATED` | 401 | Missing/invalid credentials |
| `TICKS_FORBIDDEN` | 403 | Caller lacks `pools:read` |
| `TICKS_POOL_NOT_FOUND` | 404 | Unknown pool ID |
| `TICKS_RATE_LIMITED` | 429 | Rate limit exceeded |
| `TICKS_DEPENDENCY_UNAVAILABLE` | 503 | DB/Redis outage on fail-closed path |

## Implementation Details

### Files Modified/Created

1. **Controller**: `src/pools/pools.controller.ts`
   - Added `getPoolTicks()` method
   - Enforces `pools:read` authz via `JwtAuthGuard` + scope check (deny-by-default)
   - Applies per-caller rate limiting
   - Validates pool exists before fetching ticks
   - Validates tick range, `limit`, and `cursor` parameters
   - Includes Swagger documentation

2. **Service**: `src/pools/pools.service.ts`
   - Added `getPoolTicks()` method with caching
   - Cache TTL: 5 minutes (300 seconds)
   - Cache key includes pool ID, filter parameters, and page cursor
   - Added cache invalidation method
   - Fail-closed on dependency outage for the read path (returns `503` rather than stale/partial data)

3. **Repository**: `src/pools/pools.repository.ts`
   - Added `getTicks()` method
   - Queries Prisma with optional tick range filters and keyset pagination
   - Returns ticks in ascending order by tickIndex

4. **DTO**: `src/pools/dto/get-ticks-query.dto.ts`
   - Validates optional lowerTick, upperTick, limit, and cursor parameters
   - Uses class-transformer for type conversion

5. **Types**: `src/pools/pool.types.ts`
   - Added `TickData` interface
   - Added `GetTicksQuery` interface
   - Added `PaginatedTicksResponse` interface (`data`, `nextCursor`, `hasMore`)

### Database Schema

The implementation uses the existing `Tick` model in Prisma:

```prisma
model Tick {
  id                   String   @id @default(cuid())
  poolId               String
  tickIndex            Int
  liquidityNet         String   // signed integer for net liquidity change
  liquidityGross       String   // absolute liquidity
  feeGrowthOutside0X128 String  // fee growth outside token0
  feeGrowthOutside1X128 String  // fee growth outside token1
  updatedAt            DateTime @updatedAt

  @@unique([poolId, tickIndex])
  @@index([poolId])
  @@map("tick")
}
```

### Caching Strategy

- **Cache Key Format**: `pool:ticks:v1:poolId={poolId}:lower={lowerTick}:upper={upperTick}:limit={limit}:cursor={cursor}`
- **TTL**: 300 seconds (5 minutes)
- **Invalidation**: Pattern-based invalidation when pool ticks are updated
- **Fail-Closed**: If Redis is unavailable, the endpoint returns `503 TICKS_DEPENDENCY_UNAVAILABLE` rather than serving potentially stale or partial data on the money path.

### Pagination & Limits

- Keyset pagination on `tickIndex` (cursor encodes the last returned `tickIndex`).
- Default page size `1000`, hard cap `5000`; larger requests are rejected with `TICKS_INVALID_LIMIT`.
- Cursors are signed and bound to the pool ID and tick range; a cursor replayed against a different pool or range is rejected with `TICKS_INVALID_CURSOR`.

### Authz & Rate Limiting

- All requests require a valid JWT (`JwtAuthGuard`).
- Callers must hold the `pools:read` scope; missing scope yields `403 TICKS_FORBIDDEN` (deny-by-default).
- Per-caller rate limiting is enforced; exceeding it yields `429 TICKS_RATE_LIMITED`.
- No privileged surface is exposed without an explicit scope check.

### Idempotency & Replay Safety

- The endpoint is read-only and idempotent; repeated identical requests return the same page for the same cursor.
- Cursors are single-range bound and expire after 5 minutes, preventing replay against a different range or pool.

### Observability

- Every response (success and failure) carries a `correlationId` (ULID) propagated into structured logs.
- Metrics emitted: `ticks_requests_total{status}`, `ticks_latency_seconds`, `ticks_cache_hit_ratio`, `ticks_page_size`.
- Logs never include secrets, JWTs, or raw cursor payloads.

### Performance Optimizations

1. **Database Indexing**:
   - Primary index on `[poolId, tickIndex]`
   - Secondary index on `poolId` for efficient filtering

2. **Query Optimization**:
   - Uses `select` to only fetch required fields
   - Applies filters at database level
   - Orders results by `tickIndex ASC`
   - Keyset pagination avoids `OFFSET` scans on large tick sets

3. **Caching**:
   - Aggressive caching with 5-minute TTL
   - Separate cache entries for different filter/page combinations
   - Cache invalidation on tick updates

## Testing

### Unit Tests

- `src/pools/pools.ticks.test.ts`: Controller unit tests
- Tests all acceptance criteria including error cases and auth negatives (missing scope, expired token)

### Integration Tests

- `src/pools/pools.ticks.integration.test.ts`: End-to-end tests
- Tests with real database and cache
- Tests fail-closed behavior when Redis/DB is unavailable
- Tests cursor replay/idempotency and rate-limit enforcement
- Performance validation (< 100ms requirement)

### Manual Testing

- `test-ticks-endpoint.js`: Manual testing script
- Tests various scenarios and performance
- Usage: `node test-ticks-endpoint.js [base_url] [pool_id]`

## Acceptance Criteria ✅

- ✅ Returns all initialized ticks for the pool
- ✅ Each tick includes: tick index, liquidity net, liquidity gross, fee growth outside token0, fee growth outside token1
- ✅ Supports optional lowerTick and upperTick query parameters for range filtering
- ✅ Ticks returned in ascending tick index order
- ✅ Returns 404 for unknown pool ID
- ✅ Returns empty array for pool with no initialized ticks
- ✅ Response time under 100ms at p95 (with caching)
- ✅ Authz enforced (`pools:read`), deny-by-default for new privileged surfaces
- ✅ Rate-limited per caller
- ✅ Fail-closed on dependency outage (503)
- ✅ Stable error codes + correlation ids on failures
- ✅ Pagination with bounded page size and replay-safe cursors

## Usage Examples

### Get all ticks for a pool

```bash
curl "http://localhost:3000/pools/clx1234567890123456789012/ticks"
```

### Get ticks in a specific range

```bash
curl "http://localhost:3000/pools/clx1234567890123456789012/ticks?lowerTick=-276330&upperTick=-276320"
```

### Get ticks above a certain tick

```bash
curl "http://localhost:3000/pools/clx1234567890123456789012/ticks?lowerTick=-276325"
```

### Paginate through ticks

```bash
curl "http://localhost:3000/pools/clx1234567890123456789012/ticks?limit=1000"
# then, using nextCursor from the response:
curl "http://localhost:3000/pools/clx1234567890123456789012/ticks?limit=1000&cursor=eyJ0aWNrSW5kZXgiOi0yNzYzMjR9"
```

## Rollback / Feature Flag

- The endpoint is gated behind the `FEATURE_TICKS_ENDPOINT` flag (default off in production until the readiness checklist is signed off).
- Rollback: disable the flag to return `404` for the route without redeploying; no schema changes are required.

## Future Enhancements

1. **Compression**: Enable gzip compression for large tick datasets
2. **Streaming**: Consider streaming responses for very large datasets
3. **Metrics**: Expand monitoring for cache hit rates and response times

## Dependencies

- **NestJS**: Web framework
- **Prisma**: Database ORM
- **Redis**: Caching layer
- **class-validator**: Request validation
- **class-transformer**: Type transformation
