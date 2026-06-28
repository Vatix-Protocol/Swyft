# Swyft Architecture — Indexer to API

This document describes the data flow from the Stellar Horizon node through the
indexer pipeline and into the NestJS REST/WebSocket API.

## Overview

```
Stellar Network
      │
      ▼
Horizon Node  (https://horizon-testnet.stellar.org)
      │  SSE effects stream (poll every 5 s)
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
                        │  GET  /positions                 │
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
  recorded in `WebhookDelivery`; after 5 consecutive failures a webhook is
  automatically disabled.
