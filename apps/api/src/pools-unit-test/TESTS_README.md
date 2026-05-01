# Unit Tests — pools · swaps · prices · positions

## What was generated

```
apps/api/
├── jest.config.ts                          ← drop-in replacement / merge target
└── tests/
    ├── test-utils/
    │   └── mock-factories.ts               ← shared Prisma + Redis mocks, data stubs
    ├── pools/
    │   └── pools.service.spec.ts           ← 15 tests
    ├── swaps/
    │   └── swaps.service.spec.ts           ← 17 tests
    ├── prices/
    │   └── prices.service.spec.ts          ← 21 tests
    └── positions/
        └── positions.service.spec.ts       ← 20 tests
```

Total: **73 tests** across 4 modules.

---

## Coverage map

| Module | What's covered |
|---|---|
| **Pools** | `findAll` pagination, cache hit/miss, skip calculation, `findOne` by id/address, 404 for unknown pool, cache TTL, error bubbling |
| **Swaps** | `findAll` pagination, cache hit/miss, `poolId` filter, `wallet` (sender OR recipient) filter, combined filters, `BadRequestException` on page ≤ 0, limit ≤ 0, limit > max, malformed wallet |
| **Prices** | `getSpotPrice` cache hit/miss, 404 for unknown token0/token1, 404 when no price record, cache key encodes both addresses; `getOhlcv` for all 7 interval types, interval/orderBy wiring, `from`/`to`/`limit` params, empty array result, cache hit/miss, 404 for unknown pair |
| **Positions** | 401 for null/undefined/incomplete JWT, wallet scoping, empty array on no positions, cross-wallet isolation, `status` filter (ACTIVE/CLOSED), `poolId` filter, combined status + pool filter, pagination skip/pages |

---

## Prerequisites

All four tests rely on the following provider tokens being registered in the real modules:

- `PrismaService` — injectable via `{ provide: PrismaService, useValue: ... }`
- `RedisService` — injectable via `{ provide: RedisService, useValue: ... }`

If your project uses a different token (e.g. `REDIS_CLIENT` or `IORedis`), update the
`provide:` key in each `beforeEach` block accordingly.

---

## Installation

```bash
# 1. Copy files into the monorepo
cp -r tests/   apps/api/tests/
cp jest.config.ts apps/api/jest.config.ts

# 2. Ensure dev dependencies exist
pnpm --filter api add -D jest ts-jest @types/jest @nestjs/testing

# 3. Confirm test script in apps/api/package.json
#    "scripts": { "test": "jest --config jest.config.ts --coverage" }
```

---

## Running

```bash
# All four modules
pnpm --filter api test

# With coverage report
pnpm --filter api test -- --coverage

# Single module
pnpm --filter api test -- --testPathPattern=pools
pnpm --filter api test -- --testPathPattern=swaps
pnpm --filter api test -- --testPathPattern=prices
pnpm --filter api test -- --testPathPattern=positions

# Watch mode during development
pnpm --filter api test -- --watch
```

---

## Assumptions & adaptation points

1. **Service method signatures** — tests assume the following public API:
   - `PoolsService.findAll(query: { page?, limit? })`
   - `PoolsService.findOne(idOrAddress: string)`
   - `SwapsService.findAll(query: { page?, limit?, poolId?, wallet? })`
   - `PricesService.getSpotPrice(token0: string, token1: string)`
   - `PricesService.getOhlcv(token0, token1, interval, opts?: { from?, to?, limit? })`
   - `PositionsService.findByWallet(jwt: JwtPayload, query: { page?, limit?, status?, poolId? })`

2. **Prisma model shape** — stubs in `mock-factories.ts` mirror the schema fields visible in
   the issue description. Adjust field names to match your actual `schema.prisma`.

3. **Redis calls** — tests assert `redis.set(key, jsonString, ttl)`. If your `RedisService`
   wraps `ioredis` with a different signature (e.g. `set(key, value, 'EX', ttl)`), update
   the assertions in the *cache behaviour* blocks.

4. **Wallet address validation** — the swaps 400-test for a malformed wallet assumes the
   service validates the format internally (regex or `ethers.isAddress`). If validation
   happens only in a DTO/pipe, move that assertion to a controller/e2e test instead.
