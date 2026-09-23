# Deploying apps/api: Blue/Green vs Rolling, and Migration Order

This doc captures the deployment strategy notes for `apps/api`, including how DB migrations should be sequenced relative to the deploy.

## Strategy options

### Blue/Green
- Two full environments (blue = current, green = new). Traffic cuts over once green is verified healthy.
- Pros: instant rollback (flip traffic back to blue), no mixed-version traffic during rollout.
- Cons: requires double the infra during rollout, DB schema must be compatible with both versions simultaneously during the cutover window.

### Rolling
- Instances replaced gradually, old and new versions serve traffic side by side during the rollout.
- Pros: cheaper (no duplicate full environment), simpler infra.
- Cons: old and new API versions run concurrently against the same DB, so schema changes must be backward compatible for the whole rollout window.

## Recommended migration order (either strategy)
Because old and new code may briefly run against the same database (rolling), or the DB is shared across blue/green during cutover, migrations must be **backward compatible** with the previous API version until rollout completes:

1. **Expand**: Add new columns/tables as nullable/optional, additive only. Deploy this migration first, before any code depends on it.
2. **Deploy new API version**: New code can read/write new columns; old code ignores them safely.
3. **Backfill**: Populate new columns for existing rows if needed, out of band.
4. **Cutover**: Once the new version is fully rolled out (all instances, or blue/green traffic fully switched), deploy code that relies on the new schema being present everywhere.
5. **Contract**: In a later, separate migration, drop old columns/tables only after confirming no running code path (including rollback targets) still references them.

## Rollback notes
- Blue/Green: rollback = flip traffic back to blue. Do **not** run the "contract" migration step until you're confident you won't need to roll back to a version that depends on the old schema.
- Rolling: rollback = redeploy previous image. Same constraint — don't drop old columns until all instances are confirmed on the new version and rollback is no longer a concern.

## Executable runbook

This section makes the deploy path executable end-to-end. Every step is copy-pasteable and fail-closed: if a preflight or verification check fails, **stop** — do not proceed to the next step.

### 0. Preconditions
- You have `kubectl` context set to the target cluster and the correct namespace exported:
  ```bash
  export NAMESPACE=swyft-api
  export ENVIRONMENT=staging   # or: production
  kubectl config current-context
  kubectl -n "$NAMESPACE" get deploy api
  ```
- You have the release image tag (immutable digest preferred):
  ```bash
  export IMAGE_TAG="$(git rev-parse --short HEAD)"
  export IMAGE="ghcr.io/vatix-protocol/swyft-api:${IMAGE_TAG}"
  ```

### 1. Required environment variables
Set these in the deploy environment (never commit real values; source from your secret manager):

| Variable | Purpose | Fail-closed default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection | required, no default |
| `REDIS_URL` | Cache / rate-limit backend | required, no default |
| `STELLAR_RPC_URL` | Horizon/Soroban RPC endpoint | required, no default |
| `STELLAR_NETWORK` | `testnet` or `mainnet` | required, no default |
| `JWT_SECRET` | Auth signing key | required, no default |
| `DEPLOY_KILL_SWITCH` | Disables money-path writes when `true` | `false` |
| `DEPLOY_FEATURE_FLAG` | Gates new deploy-path behavior | `false` |

Verify presence before deploying (fails if any are unset):
```bash
for v in DATABASE_URL REDIS_URL STELLAR_RPC_URL STELLAR_NETWORK JWT_SECRET; do
  [ -n "${!v:-}" ] || { echo "missing $v"; exit 1; }
done
```

### 2. Preflight checks (fail-closed)
Run all of these; abort on any non-zero exit.

```bash
# 2a. DB reachable and migrations are in a known state
psql "$DATABASE_URL" -c 'select 1;'

# 2b. Redis reachable
redis-cli -u "$REDIS_URL" ping   # expect: PONG

# 2c. RPC reachable and on the expected network
curl -fsS "$STELLAR_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | tee /tmp/rpc-health.json

# 2d. Confirm network matches the environment (guards against address drift)
[ "$STELLAR_NETWORK" = "mainnet" ] && echo "MAINNET: confirm readiness checklist before continuing"
```

If DB, Redis, or RPC is unreachable, **do not deploy** — the API fails closed on writes when these dependencies are down.

### 3. Apply migrations (expand only)
```bash
npx prisma migrate deploy
```
Only additive/expand migrations may run in this step (see migration order above).

### 4. Deploy the new image
```bash
kubectl -n "$NAMESPACE" set image deploy/api api="$IMAGE"
kubectl -n "$NAMESPACE" rollout status deploy/api --timeout=180s
```

### 5. Verification
```bash
# 5a. Liveness / readiness
kubectl -n "$NAMESPACE" get pods -l app=api
curl -fsS "https://${ENVIRONMENT}.api.swyft.example/health" | tee /tmp/api-health.json

# 5b. Authz smoke test: unauthenticated privileged call must be denied (401/403)
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://${ENVIRONMENT}.api.swyft.example/admin/deploy" \
  -H 'content-type: application/json' -d '{}'   # expect: 401 or 403

# 5c. Correlation id is echoed on responses
curl -fsS -D - -o /dev/null "https://${ENVIRONMENT}.api.swyft.example/health" \
  | grep -i 'x-correlation-id'
```

### 6. Rollback
```bash
# Rolling: redeploy the previous image
kubectl -n "$NAMESPACE" rollout undo deploy/api
kubectl -n "$NAMESPACE" rollout status deploy/api --timeout=180s

# Blue/Green: flip traffic back to the previous (blue) service
kubectl -n "$NAMESPACE" patch svc api -p '{"spec":{"selector":{"slot":"blue"}}}'
```
Do **not** run the contract migration until rollback is no longer a concern.

### 7. Kill switch
If the deploy path misbehaves on a money path, disable writes immediately without a redeploy:
```bash
kubectl -n "$NAMESPACE" set env deploy/api DEPLOY_KILL_SWITCH=true
kubectl -n "$NAMESPACE" rollout status deploy/api --timeout=120s
```
Re-enable only after the root cause is understood and verified in staging.

## Typed entrypoints, error codes, and correlation ids

Deploy-path entrypoints are typed and return stable error codes so callers and runbooks can branch deterministically. Every request carries a correlation id (`x-correlation-id`), echoed on the response and included in logs.

| Entrypoint | Method | Authz | Stable error codes |
| --- | --- | --- | --- |
| `/health` | GET | public | `503 SERVICE_UNAVAILABLE` (dependency down) |
| `/admin/deploy` | POST | admin role required | `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `409 CONFLICT` (replayed/idempotency), `503 DEPENDENCY_UNAVAILABLE` |
| `/admin/deploy/rollback` | POST | admin role required | `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `409 CONFLICT` |

- **Authz**: privileged surfaces are deny-by-default. Untrusted clients cannot bypass policy; missing/expired tokens yield `401`, wrong role yields `403`.
- **Idempotency**: mutating deploy calls require an idempotency key; concurrent or replayed requests return `409 CONFLICT` rather than double-applying.
- **Fail-closed**: when RPC/DB/Redis is unavailable, writes return `503 DEPENDENCY_UNAVAILABLE` and no state change is applied.

## Open items
- [ ] Confirm which strategy (blue/green vs rolling) the current infra actually supports for `apps/api`.
- [x] Document the specific migration tooling/commands used (Prisma migrate deploy, etc.) alongside this ordering.
