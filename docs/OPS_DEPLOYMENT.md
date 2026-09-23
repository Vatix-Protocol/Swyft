# API Deployment & Rollback Guide

This document describes deployment procedures, health checks, and rollback strategies for Swyft API production deployments.

## Deployment Model

Swyft API supports two deployment models:

| Aspect | Docker Compose (dev/staging) | Production |
|--------|------------------------------|------------|
| **Orchestration** | Docker Compose | Kubernetes, ECS, or systemd |
| **Database** | PostgreSQL in container | Managed PostgreSQL (RDS, Cloud SQL) |
| **Cache** | Redis in container | Managed Redis (ElastiCache, Memorystore) |
| **Migrations** | Manual `pnpm db:migrate:deploy` | Blue-green or rolling deploy |
| **Scaling** | Single instance | Multiple replicas with load balancer |
| **Health checks** | Container health endpoint | HTTP `/health` probe |

### CI migration smoke (local equivalent)

The `db-migrations` workflow (`.github/workflows/db-migrations.yml`) is a
manually-triggered (`workflow_dispatch`) smoke test, not a PR/main gate. It
validates the Prisma schema and pushes it to an ephemeral Postgres with
`prisma db push` — it does not run `prisma migrate deploy`. Locally:

```bash
# Start Postgres (docker-compose or otherwise), then:
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/swyft_test?schema=public
pnpm prisma validate --schema prisma/schema.prisma
pnpm prisma db push --schema prisma/schema.prisma --skip-generate
```

For an actual production deploy, use `pnpm db:migrate:deploy`
(`prisma migrate deploy`), which applies versioned migrations rather than
pushing the schema directly — see [Database Migration Order](#database-migration-order)
below.

---

## Required Environment Variables

Every production deploy must have these set before the API starts. The API
fails closed at boot if any required var is missing (see
[Fail-Closed Behavior](#fail-closed-behavior)).

| Variable | Purpose | Notes |
|----------|---------|-------|
| `DATABASE_URL` | Postgres connection string | Managed instance; TLS required in prod |
| `REDIS_URL` | Redis connection string | Managed instance; used for cache + BullMQ |
| `POOL_CONTRACT_ID` | Soroban pool contract id | Must match the target network |
| `JWT_SECRET` | Signs/verifies API JWTs | ≥32 bytes; rotate via secret manager |
| `STELLAR_NETWORK` | `testnet` or `mainnet` | Guards address drift (see below) |
| `HORIZON_URL` | Horizon endpoint | Must match `STELLAR_NETWORK` |
| `DEPLOY_KILL_SWITCH` | `on`/`off` | When `on`, deploy/ops entrypoints reject writes |

```bash
# Preflight: confirm all required vars are present and non-empty
for v in DATABASE_URL REDIS_URL POOL_CONTRACT_ID JWT_SECRET STELLAR_NETWORK HORIZON_URL; do
  if [ -z "${!v}" ]; then echo "MISSING: $v"; exit 1; fi
done
echo "env preflight OK"
```

---

## Pre-Deployment Checklist

Before deploying to production:

- [ ] **Database backup** — Run backup before migrations
  ```bash
  pnpm db:backup  # or manual: pg_dump > backup.sql
  ```
- [ ] **Review migrations** — Audit new Prisma migrations
  ```bash
  ls prisma/migrations/
  git diff HEAD~1 prisma/migrations/
  ```
- [ ] **Verify environment** — Confirm all required env vars are set
  ```bash
  # Required: DATABASE_URL, REDIS_URL, POOL_CONTRACT_ID, JWT_SECRET
  env | grep -E "DATABASE_URL|REDIS_URL|POOL_CONTRACT_ID|JWT_SECRET"
  ```
- [ ] **Confirm network/address match** — `STELLAR_NETWORK` and
  `POOL_CONTRACT_ID` must agree; a testnet contract id on mainnet is a
  fail-closed error, not a warning.
- [ ] **Test locally** — Run migrations and smoke tests on staging
  ```bash
  pnpm db:migrate:deploy
  pnpm api:test
  ```
- [ ] **Verify API build** — Ensure latest API image builds
  ```bash
  docker build -f apps/api/Dockerfile -t swyft-api:latest .
  ```

---

## Migration Strategy: Blue-Green Deployment

**Blue-green deployments minimize downtime for breaking schema changes.**

### Steps

1. **Prepare green environment** (new database with migrated schema)
   ```bash
   # On new database instance
   export DATABASE_URL="postgresql://user:pass@new-db:5432/swyft"
   pnpm db:migrate:deploy
   # Run smoke tests
   pnpm api:test
   ```

2. **Deploy new API version to green**
   ```bash
   # Point new API replicas to green database
   export DATABASE_URL="postgresql://user:pass@new-db:5432/swyft"
   docker pull swyft-api:v2.0.0
   docker-compose up -d api  # or kubectl set image deployment/api...
   ```

3. **Verify green is healthy**
   ```bash
   curl -f http://<green-api>:3001/health
   curl -f http://<green-api>:3001/indexer/status
   ```

4. **Switch load balancer to green** (cutover)
   - Update DNS, load balancer, or reverse proxy to route to green
   - Monitor error rates and latency for 5 minutes

5. **Monitor blue for rollback readiness**
   - Keep blue running for ~30 minutes in case rollback is needed
   - If issues arise, switch load balancer back to blue (see [Rollback](#rollback))

6. **Decommission blue** (after 1 hour of stable green operation)
   ```bash
   docker-compose down  # or kubectl delete deployment/api-blue
   ```

### Advantages

- ✅ Zero downtime cutover
- ✅ Simple rollback (revert DNS / load balancer)
- ✅ No impact on in-flight requests during switch

### Disadvantages

- ⚠️ Requires doubled resources during deploy window
- ⚠️ Risk: data divergence if both environments write simultaneously

---

## Rolling Deployment (Alternative)

**For non-breaking schema changes only.**

1. Deploy new API version to 1 replica (10% of traffic)
2. Monitor error rates for 2 minutes
3. Gradually increase traffic: 25% → 50% → 100%
4. If errors detected, rollback immediately (see [Rollback](#rollback))

**Constraints:**
- ✅ Efficient (no doubled resources)
- ❌ Cannot apply breaking database migrations (schema-only safe)
- ❌ Requires load balancer health checks

---

## Database Migration Order

**Always migrate database BEFORE deploying new API code:**

```
1. Database backup
   ↓
2. Run migrations (pnpm db:migrate:deploy)
   ↓
3. Verify schema applied correctly
   ↓
4. Deploy new API version
   ↓
5. Verify /health endpoint
   ↓
6. Monitor logs for errors (5 min)
```

**Why this order?**
- Migrations are idempotent (safe to re-run)
- Old API code can read new schema (backward compatible)
- New API code cannot work with old schema

**If migration fails:**
1. Stop deployment
2. Restore database from backup
3. Fix migration code
4. Test on staging
5. Retry deployment

---

## Health Checks

### API Health Endpoint

```bash
curl -v http://localhost:3001/health
# Expected: 200 OK
# Response: { "status": "ok" }
```

**Failure indicators:**
- `503 Service Unavailable` — Database or Redis unreachable
- `5xx errors` — Application crash
- Timeout (>10s) — Deployment stalled

### Database Health Check

```bash
# On production instance
psql -U postgres -h localhost -d swyft -c "SELECT 1"
# Expected: 1 row
```

### Redis Health Check

```bash
redis-cli ping
# Expected: PONG
```

### Indexer Status Check

```bash
curl http://localhost:3001/indexer/status
# Expected: { "synced": true, "ledger": 123456, "lastUpdate": "2024-07-26T..." }
```

**If indexer is behind:**
- Check `indexer:last_ledger` in Redis
- Verify HorizonService is polling effects
- Check job queue in BullMQ UI (if available)

---

## Fail-Closed Behavior

Deploy/ops entrypoints are **deny-by-default**. When a dependency is
unreachable or auth cannot be verified, the API rejects the write rather than
proceeding on stale state.

| Dependency | Symptom | Behavior |
|------------|---------|----------|
| Postgres | `DATABASE_URL` unreachable | `/health` → `503`; writes rejected |
| Redis | `REDIS_URL` unreachable | Cache misses fall through to DB; BullMQ writes rejected |
| Horizon/RPC | `HORIZON_URL` timeout | Indexer pauses; deploy verification fails closed |
| Auth | JWT expired / wrong role | `401`/`403`; no privileged action taken |

**Kill switch:** set `DEPLOY_KILL_SWITCH=on` to immediately reject all
deploy/ops write entrypoints without a redeploy. Flip it back to `off` to
resume. This is the fastest rollback for a money-path regression.

```bash
# Engage kill switch (no redeploy needed)
kubectl set env deployment/api DEPLOY_KILL_SWITCH=on
# Verify it took effect
curl -s http://localhost:3001/health | jq '.deploy'
```

---

## Graceful Shutdown (SIGTERM)

BullMQ-backed workers — the candle aggregation worker
(`CandlesWorker`, `apps/api/src/candles/candles.processor.ts`) and the
ledger indexer (`IndexerWorker`, `apps/api/src/indexer/indexer.worker.ts`) —
drain in-flight jobs on SIGTERM/SIGINT instead of dying mid-write. This is
wired through Nest's `app.enableShutdownHooks()` in `main.ts`, which calls
each provider's `onModuleDestroy()`.

**What happens on SIGTERM:**
1. The worker stops accepting new jobs immediately (`Worker#close()`).
2. Any job already running is allowed to finish rather than being cut off.
3. The wait is bounded — `CANDLES_SHUTDOWN_TIMEOUT_MS` (default `25000`) for
   candles, `INDEXER_SHUTDOWN_TIMEOUT_MS` (default `25000`) for the indexer —
   so a stuck job can't hang the process past the platform's kill timeout
   (e.g. Kubernetes' `terminationGracePeriodSeconds`, which should be set
   comfortably above these defaults).

**Why candle jobs can't leave a corrupt candle:** each period's OHLCV row is
written with a single `priceCandle.upsert()` of the fully-computed values —
there is no partial/incremental write to a candle row. If the process is
killed between pools within one aggregation run, the candles already upserted
are complete and correct; any pools not yet reached simply have a stale (not
corrupt) candle for that period, which the next scheduled run recomputes from
source data.

**Verifying a deploy drains cleanly:**
```bash
# Tail worker logs around a deploy/restart — expect these two lines with no
# unhandled rejection or crash in between:
#   "Received shutdown signal — draining in-flight candle job (timeout ...)"
#   "Candle aggregation worker shut down gracefully"
docker logs -f <api-container> 2>&1 | grep -i candle
```
If you instead see `"Timed out waiting for candle worker to drain in-flight
job — forcing shutdown"`, a job ran longer than the timeout; check for a slow
query or Redis latency before raising the timeout.

---

## Rollback Procedure

**If deployed API is experiencing errors:**

### Step 1

/* … truncated 4841 chars — edit only what you need near the top … */
