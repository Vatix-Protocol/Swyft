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

## Contributing (Stellar Wave)

- Keep Horizon write paths fail-closed; do not add best-effort writes.
- Add unit tests for invariants and auth negatives, plus integration/e2e coverage on the
  critical path.
- Update this README and any related runbooks when changing Horizon behavior.
- See `SECURITY.md` for reporting and secret-handling policy.
