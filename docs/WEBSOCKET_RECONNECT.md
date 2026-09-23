# WebSocket Reconnect

Source of truth for Swyft API WebSocket reconnect behavior. This document defines the
invariants that the reconnect implementation must uphold. Any change to reconnect
behavior must update this document in the same PR.

## Scope

Applies to the Swyft API WebSocket surface used by liquidity, trading, and settlement
clients. The server remains the source of truth for balances, swaps, and admin actions;
reconnect never grants additional authority.

## Invariants

1. **Fail-closed on writes.** A reconnect never resumes a write that was not acknowledged.
   If a dependency (RPC/Horizon, DB, Redis) is unavailable, writes fail closed with a
   stable error code rather than being replayed blindly.
2. **Idempotent resubscription.** Resubscribing to a channel after reconnect is idempotent.
   Replaying the same subscription request returns the original result and does not
   duplicate server-side state or emit duplicate events.
3. **Deny-by-default authz.** Every connect and reconnect is authenticated and authorized
   before any channel is joined. Privileged channels default to denied until explicitly
   granted. Expired credentials or wrong roles are rejected with stable auth error codes.
4. **Bounded backoff.** Clients reconnect with exponential backoff plus jitter, capped at a
   maximum interval. The server may advertise a `retryAfterMs` hint; clients must honor it.
5. **Correlation.** Every connect, reconnect, and resubscribe carries a `correlationId`
   that is echoed in responses and included in structured logs and metrics.

## Reconnect flow

1. Client detects a dropped socket and enters backoff (exponential + jitter, capped).
2. Client reconnects and re-authenticates. The server validates the credential and role
   before accepting any subscription.
3. Client resubscribes to previously held channels. Resubscription is idempotent; the
   server dedupes on the subscription key and returns the original result for replays.
4. If a required dependency is unavailable, the server rejects the resubscription with a
   stable error code and the client backs off again. Writes are never resumed optimistically.

## Stable error codes

Reconnect and resubscription errors use stable, machine-readable codes. Codes are part of
 the public contract and must not be renamed without a migration.

| Code | Meaning |
| --- | --- |
| `WS_AUTH_REQUIRED` | No credential presented on connect/reconnect. |
| `WS_AUTH_EXPIRED` | Credential expired; re-authenticate before resubscribing. |
| `WS_FORBIDDEN` | Authenticated but not authorized for the requested channel. |
| `WS_RATE_LIMITED` | Too many connect/reconnect attempts; honor `retryAfterMs`. |
| `WS_DEPENDENCY_UNAVAILABLE` | RPC/Horizon, DB, or Redis unavailable; fail closed. |
| `WS_RESUBSCRIBE_CONFLICT` | Resubscription conflicts with existing state. |

Every error response includes a `correlationId`.

## Authorization

- Connect and reconnect are deny-by-default. No channel is joined before authz succeeds.
- Privileged channels (admin, settlement) require an explicit grant; absence of a grant is
  a denial, not an implicit allow.
- Wrong role or expired credential is rejected with `WS_FORBIDDEN` / `WS_AUTH_EXPIRED`.
- Untrusted clients cannot bypass policy by reconnecting; each reconnect re-runs authz.

## Idempotency

- Resubscription requests carry an idempotency key. The server dedupes on that key and
  returns the original result for replays.
- If the dedupe store (Redis) is unavailable, resubscription fails closed with
  `WS_DEPENDENCY_UNAVAILABLE` instead of proceeding without dedupe guarantees.
- Concurrent or replayed resubscriptions must not create duplicate subscriptions or
  duplicate event delivery.

## Observability

- Emit ops-safe metrics on reconnect attempts, resubscription outcomes, and fail-closed
  rejections.
- Structured logs include `correlationId` and error code; they never include secrets,
  tokens, or raw credentials.

## Feature flags / kill switch

Reconnect behavior that affects money paths or mainnet must land behind a feature flag or
kill switch. Document the rollback procedure in the PR description before enabling on
mainnet. Rollback: disable the flag to restore the previous reconnect behavior; no
irreversible mainnet change without a readiness checklist.

## References

- `apps/api/README.md` — Horizon fail-closed write semantics, stable error codes, authz.
- `SECURITY.md` — reporting and secret-handling policy.
