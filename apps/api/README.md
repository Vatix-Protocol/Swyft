# Swyft API

NestJS API for the Swyft liquidity/trading/settlement surface. This service is the
source of truth for balances, swaps, and admin actions; clients are never trusted
to enforce policy.

## Getting started

```bash
pnpm install
pnpm --filter @vatix/api start:dev
```

## Configuration

All configuration is read from the environment at boot. Missing or malformed
values fail closed: the process refuses to start rather than running with an
unsafe default.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string (rate limiting, idempotency). |
| `STELLAR_NETWORK` | `testnet` or `mainnet`. Drives address/network drift checks. |
| `SENTRY_DSN` | Sentry DSN. When unset, Sentry is disabled. |
| `SENTRY_REDACTION_POLICY` | Redaction policy applied to every Sentry event. See below. |

## Horizon service

The Horizon service lives in `apps/api/src/horizon/`. It exposes typed entrypoints for
Horizon-backed operations and is the source of truth for balances, swaps, and admin actions.

### Fail-closed write semantics

All Horizon **write** operations are fail-closed. If a required dependency is unavailable,
the write is rejected rather than partially applied:

- **RPC / Horizon outage** — writes return `HORIZON_UNAVAILABLE` and are not retried blindly.
  Retries are only attempted for idempotent, explicitly retryable operations.
- **DB outage** — writes return `DB_UNAVAILABLE`; no in-memory state is treated as committed.
- **Redis outage** — idempotency/lock state is unavailable, so writes return `REDIS_UNAVAILABLE`
  instead of proceeding without dedupe guarantees.

Reads may degrade gracefully; writes never do.

### Stable error codes

Horizon entrypoints return stable, machine-readable error codes so clients can react
predictably. Every error response includes a `correlationId` for tracing across logs and
metrics. Codes are part of the public contract and must not be renamed without a migration.

### Idempotency

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

Redaction emits counters and structured logs that are safe to ship:

- `sentry.redaction.applied` — events scrubbed.
- `sentry.redaction.dropped` — events dropped because redaction failed.
- `sentry.redaction.policy_invalid` — boot-time policy rejection.

Logs include a correlation id and the redacted field paths only. They never
include the redacted values themselves.

### Rollback

Redaction is always on and is not gated behind a feature flag, because disabling
it would leak secrets. To roll back a bad policy change, revert the environment
value and restart; the process fails closed on invalid input, so a bad value
cannot silently disable redaction.

## Security

- Server/contract remains the source of truth for balances, swaps, and admin.
- No secrets in the repo or in logs.
- Every external entrypoint is rate-limited and authorized.
- New privileged surfaces are deny-by-default.

See `SECURITY.md` for the disclosure process and `apps/api/src/SENTRY_REDACTION_POLICY.md`
for the full policy specification.

## Contributing (Stellar Wave)

- Keep Horizon write paths and db backup/restore fail-closed; do not add best-effort writes.
- Keep changes scoped; do not refactor unrelated modules.
- Add unit tests for invariants and auth negatives, plus integration/e2e coverage on the
  critical path.
- Update this README and any related runbooks when changing Horizon or backup/restore behavior.
- Land money-path or mainnet-affecting changes behind a flag and document the
  rollback in the PR description.
- See `SECURITY.md` for reporting and secret-handling policy.
