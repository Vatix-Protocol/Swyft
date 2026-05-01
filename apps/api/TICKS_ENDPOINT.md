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

### Response Format

```json
[
  {
    "tickIndex": -276324,
    "liquidityNet": "1000000000000000000",
    "liquidityGross": "1000000000000000000", 
    "feeGrowthOutside0X128": "0",
    "feeGrowthOutside1X128": "0"
  }
]
```

### Status Codes

- **200**: Success - returns array of ticks (empty array if no ticks)
- **400**: Bad Request - invalid tick range (lowerTick > upperTick)
- **404**: Not Found - pool does not exist

## Implementation Details

### Files Modified/Created

1. **Controller**: `src/pools/pools.controller.ts`
   - Added `getPoolTicks()` method
   - Validates pool exists before fetching ticks
   - Validates tick range parameters
   - Includes Swagger documentation

2. **Service**: `src/pools/pools.service.ts`
   - Added `getPoolTicks()` method with caching
   - Cache TTL: 5 minutes (300 seconds)
   - Cache key includes pool ID and filter parameters
   - Added cache invalidation method

3. **Repository**: `src/pools/pools.repository.ts`
   - Added `getTicks()` method
   - Queries Prisma with optional tick range filters
   - Returns ticks in ascending order by tickIndex

4. **DTO**: `src/pools/dto/get-ticks-query.dto.ts`
   - Validates optional lowerTick and upperTick parameters
   - Uses class-transformer for type conversion

5. **Types**: `src/pools/pool.types.ts`
   - Added `TickData` interface
   - Added `GetTicksQuery` interface

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

- **Cache Key Format**: `pool:ticks:v1:poolId={poolId}:lower={lowerTick}:upper={upperTick}`
- **TTL**: 300 seconds (5 minutes)
- **Invalidation**: Pattern-based invalidation when pool ticks are updated
- **Graceful Degradation**: Falls back to database if Redis is unavailable

### Performance Optimizations

1. **Database Indexing**: 
   - Primary index on `[poolId, tickIndex]`
   - Secondary index on `poolId` for efficient filtering

2. **Query Optimization**:
   - Uses `select` to only fetch required fields
   - Applies filters at database level
   - Orders results by `tickIndex ASC`

3. **Caching**:
   - Aggressive caching with 5-minute TTL
   - Separate cache entries for different filter combinations
   - Cache invalidation on tick updates

## Testing

### Unit Tests
- `src/pools/pools.ticks.test.ts`: Controller unit tests
- Tests all acceptance criteria including error cases

### Integration Tests  
- `src/pools/pools.ticks.integration.test.ts`: End-to-end tests
- Tests with real database and cache
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

## Future Enhancements

1. **Pagination**: Add pagination for pools with many ticks
2. **Compression**: Enable gzip compression for large tick datasets
3. **Streaming**: Consider streaming responses for very large datasets
4. **Metrics**: Add monitoring for cache hit rates and response times
5. **Rate Limiting**: Add rate limiting to prevent abuse

## Dependencies

- **NestJS**: Web framework
- **Prisma**: Database ORM
- **Redis**: Caching layer
- **class-validator**: Request validation
- **class-transformer**: Type transformation