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
