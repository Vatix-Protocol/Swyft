# tRPC Implementation Guide for Swyft

**Status:** Archived — not implemented, no `@trpc/*` dependencies or
`apps/api/src/trpc/` in the current tree. ADR-001 (linked below) was never
accepted, so this blueprint was never approved for implementation. Kept for
reference only; the API remains REST-only. Revisit ADR-001 before reviving
this guide.  
**Related:** ADR-001, Issue #548

## Overview

This guide provides the complete blueprint for integrating tRPC into the Swyft API for type-safe web client queries. Once approved, follow these steps to implement Phase 1 (pools list prototype).

## Prerequisites

```bash
# Install at root level (monorepo-wide)
pnpm add -D trpc @trpc/server @trpc/client @trpc/react-query zod

# API package (if separate tRPC server)
# No additional installs needed — reuse existing NestJS setup
```

## Phase 1: Pools Router Prototype

### Step 1: Create tRPC Context (shared)

**File:** `apps/api/src/trpc/trpc.ts`

```typescript
import { inferAsyncReturnType } from '@trpc/server';
import { CreateNextContextOptions } from '@trpc/server/adapters/next';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Create tRPC context. Exported as type for reuse in routers.
 * Provides access to services like Prisma, Cache, Request/Response.
 */
export async function createTRPCContext(opts?: {
  prisma?: PrismaService;
  cache?: CacheService;
  req?: Request;
}) {
  return {
    prisma: opts?.prisma,
    cache: opts?.cache,
    req: opts?.req,
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// Initialize tRPC with context
import { initTRPC } from '@trpc/server';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
```

### Step 2: Define Pools Router

**File:** `apps/api/src/trpc/routers/pools.router.ts`

```typescript
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

// Input validation schemas
const GetPoolsInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  orderBy: z.enum(['tvl', 'volume24h', 'feeApr']).default('tvl'),
  search: z.string().optional(),
  feeTier: z.string().optional(),
});

type GetPoolsInput = z.infer<typeof GetPoolsInputSchema>;

/**
 * Pools tRPC router.
 * Type-safe procedures for pool queries.
 */
export const poolsRouter = router({
  /**
   * List pools with pagination and filtering.
   * Type-safe alternative to REST GET /pools.
   *
   * Query example:
   * ```ts
   * const pools = await trpc.pools.list.query({
   *   page: 1,
   *   limit: 20,
   *   orderBy: 'tvl',
   * });
   * ```
   */
  list: publicProcedure
    .input(GetPoolsInputSchema)
    .query(async ({ input, ctx }) => {
      if (!ctx.prisma) {
        throw new Error('Prisma not initialized in tRPC context');
      }

      const skip = (input.page - 1) * input.limit;

      // Build WHERE clause for filtering
      const where: any = {};
      if (input.search) {
        where.OR = [
          { token0: { symbol: { contains: input.search, mode: 'insensitive' } } },
          { token1: { symbol: { contains: input.search, mode: 'insensitive' } } },
          { token0: { address: { contains: input.search, mode: 'insensitive' } } },
          { token1: { address: { contains: input.search, mode: 'insensitive' } } },
        ];
      }
      if (input.feeTier) {
        where.feeTier = input.feeTier;
      }

      // Determine sort order
      const orderBy: any = {};
      switch (input.orderBy) {
        case 'volume24h':
          orderBy.volume24h = 'desc';
          break;
        case 'feeApr':
          orderBy.feeApr = 'desc';
          break;
        case 'tvl':
        default:
          orderBy.tvl = 'desc';
      }

      // Query pools
      const [items, total] = await Promise.all([
        ctx.prisma.pool.findMany({
          where,
          orderBy,
          skip,
          take: input.limit,
          select: {
            id: true,
            token0: { select: { symbol: true } },
            token1: { select: { symbol: true } },
            feeTier: true,
            tvl: true,
            volume24h: true,
            feeApr: true,
            currentPrice: true,
          },
        }),
        ctx.prisma.pool.count({ where }),
      ]);

      return {
        items: items.map((p) => ({
          id: p.id,
          token0: p.token0.symbol,
          token1: p.token1.symbol,
          feeTier: p.feeTier,
          tvl: p.tvl,
          volume24h: p.volume24h,
          feeApr: p.feeApr,
          currentPrice: p.currentPrice,
        })),
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
        orderBy: input.orderBy,
        search: input.search,
      };
    }),

  /**
   * Get single pool by ID.
   * Type-safe alternative to REST GET /pools/:id.
   */
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.prisma) {
        throw new Error('Prisma not initialized in tRPC context');
      }

      const pool = await ctx.prisma.pool.findUnique({
        where: { id: input.id },
        include: {
          token0: true,
          token1: true,
          recentSwaps: { take: 10, orderBy: { timestamp: 'desc' } },
        },
      });

      if (!pool) {
        throw new Error(`Pool with ID "${input.id}" not found`);
      }

      return pool;
    }),
});
```

### Step 3: Create Root tRPC Router

**File:** `apps/api/src/trpc/router.ts`

```typescript
import { publicProcedure, router } from './trpc';
import { poolsRouter } from './routers/pools.router';

/**
 * Root tRPC router combining all sub-routers.
 * Each sub-router (pools, swaps, tokens, etc.) is added here.
 */
export const appRouter = router({
  pools: poolsRouter,
  // Future: swaps: swapsRouter, tokens: tokensRouter, ...
});

export type AppRouter = typeof appRouter;
```

### Step 4: Integrate with NestJS

**File:** `apps/api/src/trpc/trpc.controller.ts`

```typescript
import { Controller, Post, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { createHttpServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router';
import { createTRPCContext } from './trpc';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * tRPC HTTP adapter controller for NestJS.
 * Maps POST /trpc/* to tRPC procedures.
 */
@Controller('trpc')
export class TRPCController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Post('*')
  async handleTRPC(@Req() req: Request, @Res() res: Response) {
    // Create tRPC context with services
    const context = await createTRPCContext({
      prisma: this.prisma,
      cache: this.cache,
      req,
    });

    // Route request through tRPC
    const caller = appRouter.createCaller(context);

    // Extract procedure name from URL: /trpc/pools.list → 'pools.list'
    const procedure = req.path
      .replace('/trpc/', '')
      .replace(/^\//, '')
      .split('/')
      .join('.');

    try {
      const body = req.body;
      const result = await (caller as any)[procedure](body?.input || {});
      res.json({ result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
}
```

### Step 5: Web Client Integration

**File:** `apps/web/lib/trpc.ts` (new)

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../api/src/trpc/router';

export const trpc = createTRPCReact<AppRouter>();
```

**File:** `apps/web/hooks/usePools.ts` (replace fetch)

```typescript
import { trpc } from '../lib/trpc';

export function usePools(page = 1, limit = 20, orderBy = 'tvl') {
  const { data, isLoading, error } = trpc.pools.list.useQuery({
    page,
    limit,
    orderBy,
  });

  return {
    pools: data?.items ?? [],
    isLoading,
    error,
    page: data?.page,
    total: data?.total,
  };
}
```

## Validation & Error Handling

### Input Validation with Zod

All tRPC procedures use Zod for input validation:

```typescript
const input = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
  search: z.string().optional(),
});
```

Zod throws `ZodError` on validation failure → tRPC returns 400 with error details.

### Error Responses

tRPC standardizes errors:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid input: page must be >= 1",
    "data": {
      "code": "INVALID_ARGUMENT",
      "zodError": { /* validation details */ }
    }
  }
}
```

## Caching Strategy

### Response Caching (via CacheService)

```typescript
list: publicProcedure.input(...).query(async ({ input, ctx }) => {
  const cacheKey = `pools:${JSON.stringify(input)}`;
  
  // Check cache
  const cached = await ctx.cache?.get(cacheKey);
  if (cached) return cached;
  
  // Query and cache for 30s
  const result = await ctx.prisma.pool.findMany(...);
  await ctx.cache?.set(cacheKey, result, 30);
  
  return result;
}),
```

### Query Batching

tRPC automatically batches multiple requests in a single HTTP call (when configured):

```typescript
// Web client fires N queries → tRPC sends 1 HTTP request with all
trpc.useContext().setQueryData(['pools.list', { page: 1 }], data);
```

## Testing Phase 1 Router

### Unit Test Example

**File:** `apps/api/src/trpc/routers/pools.router.spec.ts`

```typescript
describe('poolsRouter', () => {
  it('should return paginated pools', async () => {
    const caller = appRouter.createCaller({
      prisma: mockPrisma,
      cache: mockCache,
    });

    const result = await caller.pools.list({
      page: 1,
      limit: 10,
      orderBy: 'tvl',
    });

    expect(result.items).toHaveLength(10);
    expect(result.total).toBeGreaterThanOrEqual(10);
    expect(result.page).toBe(1);
  });

  it('should filter by search term', async () => {
    const result = await caller.pools.list({
      page: 1,
      limit: 20,
      search: 'USDC',
    });

    expect(
      result.items.every(
        (p) =>
          p.token0.includes('USDC') ||
          p.token1.includes('USDC')
      )
    ).toBe(true);
  });
});
```

## Next Steps (Phase 2)

Once Phase 1 (pools router) is merged:

1. **Auth middleware** — Wrap procedures with JWT verification
2. **Response caching** — Integrate Redis for frequently accessed pools
3. **Batch operations** — Support `pools.byIds([id1, id2, ...])` in one call
4. **Error types** — Create custom error classes for domain-specific errors
5. **Monitoring** — Track tRPC procedure latency in metrics

## References

- [tRPC Docs](https://trpc.io/docs)
- [Zod Validation](https://zod.dev)
- [NestJS Integration](https://docs.nestjs.com)

---

**Approved by:** ADR-001  
**Implementation Lead:** To be assigned  
**Timeline:** Phase 1 target: 1 sprint (8–12h)
