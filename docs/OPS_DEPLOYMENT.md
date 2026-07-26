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

### CI migration smoke (local equivalent)

GitHub Actions runs Prisma migrate against ephemeral Postgres on main/PRs
(`.github/workflows/db-migrations.yml`). Locally:

```bash
# Start Postgres (docker-compose or otherwise), then:
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/swyft_test?schema=public
pnpm prisma migrate deploy --schema prisma/schema.prisma
pnpm prisma migrate status --schema prisma/schema.prisma
```

Or simply: `pnpm db:migrate:deploy` with your local `DATABASE_URL` set.
A failing migrate fails the CI job.
| **Scaling** | Single instance | Multiple replicas with load balancer |
| **Health checks** | Container health endpoint | HTTP `/health` probe |

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

## Rollback Procedure

**If deployed API is experiencing errors:**

### Step 1: Assess the Issue (30 seconds)

```bash
# Check API logs for crashes
docker logs swyft-api | tail -50
# or
kubectl logs -l app=api --tail=50

# Check error rates (if using Sentry)
curl https://sentry.io/api/0/organizations/swyft/issues/?query=is:unresolved

# Check if database is healthy
curl -f http://localhost:3001/health
```

### Step 2: Decide Rollback Scope

| Issue | Rollback Scope |
|-------|----------------|
| API crashed on startup | **API only** (revert to previous version) |
| Database schema error | **API + schema** (revert schema + API) |
| Redis unreachable | **Check infrastructure** (not an API rollback) |

### Step 3: Rollback Database (if needed)

**Only required if schema migration caused the issue:**

```bash
# Option A: Restore from backup
pg_restore -d swyft backup-2024-07-26.sql

# Option B: Rollback migrations (if using Prisma versioning)
pnpm db:migrate:resolve --rolled-back "<migration-name>"
```

### Step 4: Rollback API Code

```bash
# Blue-green: Switch load balancer back to blue (old version)
# Edit /etc/nginx/nginx.conf or load balancer config:
# upstream api { server <blue-api>:3001; }

# Rolling: Restart old API replicas
docker-compose down
docker-compose -f docker-compose.old.yml up -d
# or
kubectl rollout undo deployment/api
```

### Step 5: Verify Rollback

```bash
curl -f http://localhost:3001/health
curl http://localhost:3001/indexer/status

# Verify no data corruption
psql -U postgres -d swyft -c "SELECT COUNT(*) FROM pools;"

# Monitor logs
docker logs -f swyft-api
```

### Step 6: Post-Mortem

After rollback stabilizes:

1. **Review the failed deployment**
   - Did tests catch it? Why not?
   - Should migration have been staged?

2. **Fix root cause on a branch**
   ```bash
   git checkout -b fix/deploy-issue-2024-07-26
   # Fix code/migration
   # Test locally and on staging
   ```

3. **Re-deploy after fix is validated**

---

## Docker Compose vs. Production Differences

### Docker Compose (Local/Staging)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d swyft"]
      interval: 5s
      retries: 10
```

**Characteristics:**
- Single instance (no HA)
- Data persisted via Docker volume
- Healthchecks are Docker-native (exit code 0/1)
- Environment via `.env` file
- No external monitoring

### Production (Kubernetes / ECS)

```yaml
# Kubernetes example
apiVersion: v1
kind: Deployment
metadata:
  name: swyft-api
spec:
  replicas: 3  # ← Multiple replicas
  template:
    spec:
      containers:
      - name: api
        image: swyft-api:v2.0.0
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
```

**Differences:**
- Multiple replicas (HA / load balancing)
- External database (RDS, Cloud SQL) — no volumes
- HTTP probes (not Docker health checks)
- Secrets management (not `.env` files)
- Logging aggregation (CloudWatch, Stackdriver)
- Monitoring + alerting (Prometheus, Datadog)

### Migration Differences

| Step | Docker Compose | Production |
|------|----------------|------------|
| **Backup** | Manual `docker exec` or script | Managed backup service (RDS snapshots) |
| **Migrate** | `pnpm db:migrate:deploy` on host | Init container or separate job |
| **Deploy** | `docker-compose up -d` | `kubectl apply` or `docker service update` |
| **Rollback** | Restart old container | Revert image tag, rollout undo |
| **Monitoring** | Manual log tail | Aggregated logs + dashboards |

---

## Deployment Checklist Template

Use before every production deployment:

```
Deployment: swyft-api v2.0.0 → production
Date: 2024-07-26
Deployer: [name]

PRE-DEPLOYMENT
  [ ] Database backup completed
  [ ] Migrations reviewed (no breaking changes without blue-green)
  [ ] Environment variables verified
  [ ] API tests passing locally
  [ ] Staging deployment successful

DEPLOYMENT
  [ ] Backup verified (can restore if needed)
  [ ] Database migrations applied (pnpm db:migrate:deploy)
  [ ] New API version deployed
  [ ] Health check passing (curl /health)
  [ ] Indexer status normal

POST-DEPLOYMENT (5 min monitoring)
  [ ] Error rates normal (<0.1%)
  [ ] API response times normal (<100ms p95)
  [ ] No Sentry alerts
  [ ] Database CPU normal (<50%)
  [ ] Redis memory normal
  [ ] Logs show no errors

SIGN-OFF
  Deployment: ✅ SUCCESSFUL
  Rollback readiness: ✅ Blue still running, ready if needed
  Next review: 2024-07-26 12:00 UTC
```

---

## Quick Links

- [API Changelog](API_CHANGELOG.md) — Breaking changes and version history
- [Architecture](ARCHITECTURE.md) — Data flow and component overview
- [Local Setup](../README.md#local-dev--quick-start-5-minutes) — Getting started guide
