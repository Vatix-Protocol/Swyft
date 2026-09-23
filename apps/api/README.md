# Swyft API

Backend API for Swyft, including the Horizon service used for liquidity, trading, and settlement operations.

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

## Contributing (Stellar Wave)

- Keep Horizon write paths and db backup/restore fail-closed; do not add best-effort writes.
- Add unit tests for invariants and auth negatives, plus integration/e2e coverage on the
  critical path.
- Update this README and any related runbooks when changing Horizon or backup/restore behavior.
- See `SECURITY.md` for reporting and secret-handling policy.
