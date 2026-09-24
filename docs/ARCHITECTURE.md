# Swyft Architecture — Indexer to API

This document describes the data flow from the Stellar Horizon node through the
indexer pipeline and into the NestJS REST/WebSocket API.

> **Related docs:** [README.md](../README.md) (repo overview & quickstart) ·
> [SECURITY.md](../SECURITY.md) (trust boundaries, secrets, disclosure) ·
> [CONTRACTS.md](../CONTRACTS.md) (contract tree & deployment) ·
> [docs/FEE_COLLECTOR_AUTH.md](./FEE_COLLECTOR_AUTH.md) (fee-collector authz model).

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

## Monorepo Layout

The repository is a pnpm workspace. The API is the only runtime service in
this tree; contracts and SDK are libraries consumed by it and by external
clients.

| Path | Package | Role |
|---|---|---|
| `apps/api/` | `@swyft/api` | NestJS REST/WebSocket service — indexer, query layer, auth, webhooks |
| `packages/contract/` | Rust workspace | **Canonical** Soroban contracts (see below) |
| `packages/contracts/` | Rust workspace | **Legacy / orphaned** — reference only, not built or deployed |
| `packages/sdk/` | `@swyft/sdk` | Transaction builders for liquidity operations |
| `docs/` | — | Architecture, ADRs, and operational runbooks |

## Component Responsibilities

| Component | Path | Role |
|---|---|---|
| `HorizonService` | `apps/api/src/horizon/horizon.service.ts` | Polls Stellar Horizon, parses on-chain events, enqueues jobs |
| `IndexerWorker` | `apps/api/src/indexer/indexer.worker.ts` | Consumes BullMQ queues, persists canonical events and projections |
| `WebhooksService` | `apps/api/src/webhooks/webhooks.service.ts` | Fans out events to registered HTTPS endpoints |
| `PoolsService` | `apps/api/src/pools/pools.service.ts` | Query layer for pool data |
| `PriceService` | `apps/api/src/price/price.service.ts` | Real-time price broadcasts over WebSocket |
| `CacheService` | `apps/api/src/cache/cache.service.ts` | Redis wrapper — ledger checkpoint, pub/sub, response cache |
| `PrismaService` | `apps/api/src/prisma/prisma.service.ts` | Shared Prisma client |
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

## Trust Boundaries & Invariants

- **Source of truth.** On-chain contracts are the sole authority for balances,
  swaps, and admin actions. The API and indexer are read models: they project
  and serve contract state, and never mutate balances or settle trades.
- **Deny-by-default.** Every privileged surface (admin routes, webhook
  management, position queries) requires explicit authorization; new
  privileged endpoints must be gated before they are exposed.
- **No secrets in repo or logs.** Credentials, signing keys, and webhook
  secrets are supplied via environment/secret stores and must never be
  committed or written to logs. See [SECURITY.md](../SECURITY.md).
- **Fail-closed on writes.** When a dependency (Horizon RPC, PostgreSQL,
  Redis) is unavailable, write paths reject rather than proceed on stale or
  partial state; the ledger checkpoint only advances after a successful
  persist.

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
