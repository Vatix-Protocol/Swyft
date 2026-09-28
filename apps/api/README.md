# Swyft API

The Swyft API is the HTTP entrypoint for the Swyft trading/liquidity surface. It exposes
health and readiness probes used by orchestrators (Kubernetes, load balancers, CI smoke
tests) and by Stellar Wave contributors running the stack locally.

## Health vs. readiness

Liveness and readiness are intentionally **separate** endpoints. They answer different
questions and must not be conflated:

| Endpoint        | Purpose   | Dependency checks | Failure semantics |
| --------------- | --------- | ----------------- | ----------------- |
| `GET /health`       | Liveness  | None              | Process is up and the event loop is responsive. Always `200` while the process is alive. |
| `GET /health/ready` | Readiness | Critical dependencies (DB, Redis, RPC) | `200` only when **all** critical dependencies are reachable. Otherwise non-2xx (fail-closed). |

### Why they are separate

- **Liveness must stay dependency-free.** A transient DB/Redis/RPC outage must not cause
  the orchestrator to kill and restart a healthy process. Restarting does not fix a
  downstream outage and only amplifies it.
- **Readiness must fail-closed.** If a critical dependency is unavailable, the instance
  must be removed from rotation so it cannot serve writes against partial/degraded state.
  Readiness never reports `ready` on a degraded dependency set for write paths.

## `GET /health` (liveness)

- No dependency checks, no I/O.
- Returns `200` with a minimal, typed payload.
- Safe to poll at high frequency.

## `GET /health/ready` (readiness)

- Checks each critical dependency (DB, Redis, RPC).
- Returns `200` **only** when every critical dependency is reachable.
- Returns a non-2xx status (e.g. `503`) when any critical dependency is unavailable.
- The response body is a **typed DTO** with a stable error code and a correlation id —
  never an ad-hoc stringly-typed payload.

### Response shape

Ready (all dependencies healthy):

```json
{
  "status": "ready",
  "correlationId": "<uuid>",
  "checks": {
    "db": "up",
    "redis": "up",
    "rpc": "up"
  }
}
```

Not ready (fail-closed, non-2xx):

```json
{
  "status": "not_ready",
  "code": "DEPENDENCY_UNAVAILABLE",
  "correlationId": "<uuid>",
  "checks": {
    "db": "up",
    "redis": "down",
    "rpc": "up"
  }
}
```

### Stable error codes

Readiness failures use stable, machine-readable codes so callers and dashboards can
react deterministically:

| Code                       | Meaning                                                        |
| -------------------------- | -----------------------------------------------------------

## Local Docker / Compose

There are two compose files in this repo. They serve different purposes and are
**not** interchangeable — pick the one that matches what you are trying to run.

| Compose file               | Purpose                                                                 | When to use it                                                                 |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docker-compose.yml` (root) | Orchestrates the **full stack**: API, web, and shared backing services. | Running the whole product locally, or any change that spans more than the API. |
| `apps/api/docker-compose.yml` | **API-local** stack: the API plus only the dependencies it needs.      | Iterating on the API in isolation (fast loop, API-only tests).                 |

Relationship: the root compose is the superset. `apps/api/docker-compose.yml` is a
narrower, API-scoped view of the same services. Where the two overlap, service
names, ports, and environment variable names are kept consistent so you can move
between them without re-learning the layout. Intentional differences are limited to
scope: the API-local file omits non-API services (e.g. web) and any root-only
orchestration.

### Commands

Full stack (root compose):

```bash
docker compose up --build
```

API-local (from `apps/api`):

```bash
cd apps/api
docker compose up --build
```

### Expected endpoints

- API: `http://localhost:3000` (health at `http://localhost:3000/health`).
- Web (root compose only): `http://localhost:3001`.

If a port or env var name ever diverges between the two files, treat that as a bug:
fix the divergence or document the intentional difference here rather than letting
the two files drift.

## Configuration

```json
{
  "status": "not_ready",
  "code": "DEPENDENCY_UNAVAILABLE",
  "correlationId": "<uuid>",
  "checks": {
    "db": "up",
    "redis": "down",
    "rpc": "up"
  }
}
```

### Stable error codes

Readiness failures use stable, machine-readable codes so callers and dashboards can
react deterministically:

| Code                       | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `DEPENDENCY_UNAVAILABLE`   | One or more critical dependencies are unreachable.             |
| `DEPENDENCY_TIMEOUT`       | A dependency check exceeded its deadline.                      |
| `READINESS_CHECK_FAILED`   | Readiness could not be determined (unexpected internal error). |

Codes are part of the public contract; do not rename them without a versioned change.

## Security

- Health responses **never** include secrets, connection strings, credentials, or
  internal hostnames. Only coarse `up`/`down` states and stable codes are exposed.
- Logs and metrics emitted by the health path follow the same rule: no secrets, no
  connection strings, no internal hostnames.
- Readiness is safe to expose to untrusted clients because it leaks no sensitive
  topology; still, rate-limit and authorize external entrypoints per the API policy.
- The server remains the source of truth for balances, swaps, and admin. Health
  endpoints never mutate state.

## Observability

- Readiness transitions are logged with the correlation id and the failing dependency
  name (coarse state only).
- Metrics track readiness state and per-dependency check outcomes so on-call can act on
  money-path availability without inspecting payloads.

## Orchestrator wiring

- `livenessProbe` → `GET /health`
- `readinessProbe` → `GET /health/ready`

Do not point the liveness probe at `/health/ready`; doing so reintroduces the
restart-on-dependency-outage failure mode described above.

## Rollback / kill-switch

Readiness gating is safe to disable by pointing the readiness probe at `/health` if a
false-negative dependency check is suspected. Document the change in the PR and restore
fail-closed readiness once the dependency check is corrected.

## Idempotency

Concurrent or replayed Horizon write requests must be idempotent. Clients supply an
idempotency key; the service dedupes on that key and returns the original result for
replays. If the dedupe store is unavailable, the write fails closed (see above).

### Authorization

Horizon entrypoints are deny-by-default. Untrusted clients cannot bypass policy:

- Every external entrypoint is authenticated and authorized before any state change.
- New privileged surfaces default to denied until explicitly granted.
- Expired credentials or wrong roles are rejected with stable auth error codes.

### Observability

Horizon emits ops-safe metrics and structured logs on money paths (writes, retries,
fail-closed rejections). Logs and metrics never include secrets, tokens, or raw
credentials. Correlation ids tie client requests to server-side traces.

### Feature flags / kill switch

Money-path or mainnet-affecting Horizon changes must land behind a feature flag or kill
switch. Document the rollback procedure in the PR description before enabling on mainnet.

## Database backup & restore

The API ships operational scripts for database backup and restore:

- `apps/api/scripts/db-backup.sh` — creates a consistent, timestamped database backup.
- `apps/api/scripts/db-restore.sh` — restores a database from a backup artifact.

### Fail-closed semantics

Backup and restore are privileged, money-path-adjacent operations and are **fail-closed**:

- If the database or object storage dependency is unavailable, the operation aborts with a
  non-zero exit code rather than producing a partial or unverified artifact.
- Restore refuses to run against a target it cannot fully verify; a failed restore never
  leaves the database in a half-applied state.
- Writes are never treated as committed on dependency outage.

### Stable error codes

Both scripts emit stable, machine-readable error codes on failure so operators and CI can
react predictably. Every invocation is tagged with a `correlationId` (echoed in logs) so a
backup/restore can be traced end-to-end. Codes are part of the operational contract and must
not be renamed without a migration.

### Idempotency

Backup and restore are safe to re-run:

- Backups are content-addressed/timestamped; re-running produces a new artifact without
  corrupting prior ones.
- Restore is idempotent for a given backup artifact — replaying the same restore converges to
  the same state and does not double-apply.
- Concurrent invocations are serialized via a lock; if the lock store is unavailable the
  operation fails closed instead of racing.

### Authorization

These scripts are deny-by-default privileged surfaces:

- Credentials are read from the environment only — never hardcoded and never committed.
- Untrusted callers cannot bypass policy; the scripts require the appropriate role/credentials
  before touching the database.
- Missing or expired credentials cause a fail-closed abort with a stable auth error code.

### Observability

Backup/restore emit ops-safe logs and metrics (start, success, failure, duration, artifact
size). Logs and metrics never include secrets, tokens, connection strings, or raw credentials.
The `correlationId` ties each run to its logs and metrics.

### Feature flags / kill switch

Any mainnet-affecting backup/restore change must land behind a feature flag or kill switch.
Document the rollback procedure in the PR description before enabling on mainnet.

## Sentry redaction policy

`SENTRY_REDACTION_POLICY` controls how outbound Sentry events are scrubbed before
they leave the process. The policy is **server-owned**: it is read from the
environment at boot and cannot be overridden by request headers, query params,
or any other client-controlled input. There is no client opt-out.

Behavior is deny-by-default and fail-closed:

- Every event passes through the redaction pipeline before transport.
- Fields not explicitly allow-listed are redacted, not forwarded.
- Unknown or malformed policy values cause the process to fail closed at boot
  (stable error code `SENTRY_REDACTION_POLICY_INVALID`) rather than silently
  degrading to an unredacted transport.
- Redaction failures drop the event and emit an ops-safe counter; they never
  fall back to sending the raw payload.

### Invariants

1. No secret, token, credential, or PII value is ever serialized into an event
   that reaches the Sentry transport.
2. The policy is resolved once at boot and is immutable for the process
   lifetime; there is no runtime path that widens it.
3. Untrusted clients cannot influence the policy, the allow-list, or the
   redaction outcome.
4. Redaction is applied to the full event envelope (message, exception values,
   breadcrumbs, request data, tags, and extra), not just the top-level message.

### Observability

Redaction emits counters and str
