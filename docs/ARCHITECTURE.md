# Swyft Architecture — Indexer to API

This document describes the data flow from the Stellar Horizon node through the
indexer pipeline and into the NestJS REST/WebSocket API.

## Overview

```
Stellar Network
      │  contracts: every pool swap also writes an
      │  observation to its oracle-adapter instance
      ▼
Horizon Node  (https://horizon-testnet.stellar.org)
      │  REST effects endpoint (polled every 5 s)
      ▼
HorizonService           apps/api/src/horizon/horizon.service.ts
  • Polls effects for POOL_CONTRACT_ID
  • Parses raw effect records into typed job payloads
  • Broadcasts live price events via PriceService (WebSocket)
  • Updates pool state via PoolsService
  • Publishes Redis pub/sub message (prices:<poolId>)
  │
  ├─► BullMQ Queue: pool.created
  ├─► BullMQ Queue: swap.processed
  ├─► BullMQ Queue: position.minted
  └─► BullMQ Queue: position.burned
                      │   (Redis-backed, durable)
                      ▼
             IndexerWorker            apps/api/src/indexer/indexer.worker.ts
               • One Worker per queue
               • Idempotent upserts via eventId
               • Guards empty / malformed payloads
               • Advances ledger checkpoint in Redis
               │
               ├─► PostgreSQL (via Prisma)
               │     PoolCreated, SwapProcessed,
               │     PositionMinted, PositionBurned,
               │     FeesCollected canonical event tables
               │     Pool, Swap, Position projection tables
               │
               └─► WebhooksService   apps/api/src/webhooks/webhooks.service.ts
                     • Fans out to subscriber webhooks
                     • Signed delivery via HMAC-SHA256
                     • Delivery tracked in WebhookDelivery table
                              │
                              ▼
                        NestJS REST API
                        ┌──────────────────────────────────┐
                        │  GET  /pools                     │
                        │  GET  /pools/:id                 │
                        │  GET  /pools/:id/ticks           │
                        │  GET  /swaps                     │
                        │  GET  /positions        (JWT)    │
                        │  GET  /tokens                    │
                        │  GET  /search                    │
                        │  GET  /indexer/status            │
                        │  GET  /health                    │
                        │  POST /auth/nonce                │
                        │  POST /auth/verify               │
                        │  GET|POST|DELETE /webhooks       │
                        └──────────────────────────────────┘
                                      │
                              WebSocket Gateway
                              (price feed, pool updates)

`(JWT)` marks routes requiring a valid `Authorization: Bearer` token. All
`/positions` endpoints apply `JwtAuthGuard` (`positions.controller.ts`) —
pool, swap, token, and search routes remain public.
```

## Component Responsibilities

| Component | Path | Role |
|---|---|---|
| `HorizonService` | `src/horizon/horizon.service.ts` | Polls Stellar Horizon, parses on-chain events, enqueues jobs |
| `IndexerWorker` | `src/indexer/indexer.worker.ts` | Consumes BullMQ queues, persists canonical events and projections |
| `WebhooksService` | `src/webhooks/webhooks.service.ts` | Fans out events to registered HTTPS endpoints |
| `PoolsService` | `src/pools/pools.service.ts` | Query layer for pool data |
| `PriceService` | `src/price/price.service.ts` | Real-time price broadcasts over WebSocket |
| `CacheService` | `src/cache/cache.service.ts` | Redis wrapper — ledger checkpoint, pub/sub, response cache |
| `PrismaService` | `src/prisma/prisma.service.ts` | Shared Prisma client |
| `OracleAdapter` (contract) | `packages/contract/contracts/oracle-adapter` | Per-pool circular-buffer TWAP oracle; `pool`/`cl-pool` write a post-swap observation on every swap, `get_twap(window_secs)` serves time-weighted average prices |

## Contract Package Layout

There are **two** Rust workspaces under `packages/` and they are not the same
tree — do not assume one is a copy of the other:

| Path | Status | Cargo workspace | Members |
|---|---|---|---|
| `packages/contract/` (singular) | **Canonical** — this is what the app, deployments, and docs build against | `packages/contract/Cargo.toml` | `math-lib`, `pool`, `pool-factory`, `router`, `position-nft`, `fee-collector`, `oracle-adapter`, `cl-pool` |
| `packages/contracts/` (plural) | **Legacy / orphaned** — not referenced by `README.md`, `docs/ARCHITECTURE.md`, deployment configs, or CI; has its own disconnected `Cargo.toml` (`workspace.package.repository` still points at a stale fork) | `packages/contracts/Cargo.toml` | `fee-collector`, `router` |

The two `fee-collector` and `router` contracts under `packages/contracts/`
have **diverged** from their `packages/contract/contracts/` counterparts —
they are not duplicates with identical content, they implement different
logic. Notably, `packages/contracts/fee-collector` contains the full
authorization model (admin/authorized-pool registry, fee-switch gating)
described in `docs/FEE_COLLECTOR_AUTH.md`, while `packages/contract/contracts/fee-collector`
(the contract actually wired into the workspace, deployments, and CI) is
currently a minimal stub (`name`/`initialize`/`get_treasury` only) and does
**not** yet implement that authorization model. This divergence is tracked as
a known gap — do not treat `docs/FEE_COLLECTOR_AUTH.md` as a description of
the shipped `packages/contract/contracts/fee-collector` behavior until the
logic is ported over.

**Guidance for contributors:** treat `packages/contract/` (singular) as the
only actively maintained contract tree. Changes intended to ship should go
there. `packages/contracts/` (plural) is kept only as a reference for logic
that has not yet been ported/reconciled into the canonical tree; do not build
new features on top of it, since it is not compiled, tested, or deployed by
anything in this repo.

## Ledger Checkpoint

`HorizonService` and `IndexerWorker` both write to the Redis key
`indexer:last_ledger` via `CacheService.setMaxNumber`. The value is
monotonically increasing — a ledger is only recorded after its event has been
successfully persisted, preventing silent data loss on restart.

## Durability Guarantees

- **At-least-once delivery**: BullMQ retries stalled or failed jobs up to
  `maxStalledCount` times. All handlers are idempotent via `eventId` upserts.
- **Ordered checkpoint**: The ledger cursor only advances after a successful
  Prisma write, so a crash mid-job results in a retry, not a skipped ledger.
- **Webhook delivery tracking**: Every delivery attempt (success or failure) is
  recorded in `WebhookDelivery`; after `WEBHOOK_MAX_CONSECUTIVE_FAILS`
  (default `10`) consecutive failures a webhook is automatically disabled.

## SDK Liquidity Module

The `@swyft/sdk` package provides transaction builders for liquidity operations:

- `buildAddLiquidityTx` — Builds mint/add_liquidity transactions
- `buildBurnTx` — Builds burn/remove_liquidity transactions
- `buildCollectTx` — Builds collect fee transactions
- `buildRerangeTx` — Atomic remove + add in a single transaction
- `detectPoolType` — Detects pool vs cl-pool ABI via contract `name()` method

All builders accept a `poolType` parameter (`'pool'` or `'cl_pool'`) to handle
the different contract ABIs. The SDK targets the Stellar testnet by default.
