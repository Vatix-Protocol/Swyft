# tRPC Implementation Guide for Swyft

**Status:** Archived — not implemented, no `@trpc/*` dependencies or
`apps/api/src/trpc/` in the current tree. ADR-001 (linked below) was never
accepted, so this blueprint was never approved for implementation. Kept for
reference only; the API remains REST-only. Revisit ADR-001 before reviving
this guide.  
**Related:** ADR-001, Issue #548

> **Decision (Issue #1001):** The GraphQL vs tRPC transport decision is
> **recorded** in [`docs/GRAPHQL_VS_TRPC_SPIKE.md`](./GRAPHQL_VS_TRPC_SPIKE.md).
> Outcome: **REST remains the canonical transport**; tRPC is **rejected** for
> now and GraphQL is **deferred**. This guide is therefore **non-canonical** —
> it must not be treated as an approved implementation plan. Any revival
> requires a new ADR that supersedes the recorded decision.

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
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
  };
}
```

## Invariants (apply to any future transport work)

These invariants are recorded in the decision doc and must hold regardless of
transport. They are listed here so this guide cannot be read as relaxing them:

- **Server/contract is the source of truth** for balances, swaps, and admin
  actions. Clients (REST, tRPC, or GraphQL) never compute authoritative state.
- **Deny-by-default authz** on every entrypoint; untrusted clients cannot
  bypass policy. See `apps/api/src/auth/AUTH_FLOW.md` and `SECURITY.md`.
- **Idempotency** for concurrent/replayed requests on money paths.
- **Fail-closed writes** when RPC/DB/Redis dependencies are unavailable.
- **Auth expiry / wrong role** returns stable error codes, never partial writes.
- **No secrets** in repo or logs; correlation ids only.

## Feature flag / rollback

Any money-path or mainnet-affecting change must land behind a feature flag or
kill-switch with a documented rollback in the PR description. This guide does
not authorize bypassing that requirement.

## References

- [`docs/GRAPHQL_VS_TRPC_SPIKE.md`](./GRAPHQL_VS_TRPC_SPIKE.md) — recorded decision (Issue #1001)
- [`apps/api/src/auth/AUTH_FLOW.md`](../apps/api/src/auth/AUTH_FLOW.md) — authz invariants
- [`SECURITY.md`](../SECURITY.md) — security policy and deny-by-default posture
