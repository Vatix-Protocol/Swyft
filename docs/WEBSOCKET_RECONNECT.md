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
| `WS_AUTH_INVALID` | Credential presented but not valid (bad signature, wrong issuer/audience, no wallet claim). Never downgraded to anonymous. |
| `WS_INVALID_REQUEST` | Malformed handshake or message (e.g. `poolId` not matching `[A-Za-z0-9._:-]{1,128}`). |
| `WS_SUBSCRIPTION_LIMIT` | Per-connection subscription cap reached. |

Every error response includes a `correlationId`.

## Authorization

- Connect and reconnect are deny-by-default. No channel is joined before authz succeeds.
- Privileged channels (admin, settlement) require an explicit grant; absence of a grant is
  a denial, not an implicit allow.
- Wrong role or expired credential is rejected with `WS_FORBIDDEN` / `WS_AUTH_EXPIRED`.
- Untrusted clients cannot bypass policy by reconnecting; each reconnect re-runs authz.

## Pool updates authn policy (`/price`)

The `/price` gateway streams pool price updates. Implementation:
`apps/api/src/price/ws-auth-policy.ts` (policy) and
`apps/api/src/price/price.gateway.ts` (enforcement). Tests:
`apps/api/src/price/price.gateway.spec.ts`.

Pool prices are public market data, so authentication on this one surface is
**operator-selectable**. It is still deny-by-default:

| `WS_POOL_UPDATES_AUTH_MODE` | Behaviour |
| --- | --- |
| `required` (default) | A valid JWT (`?token=`) is required. Missing → `WS_AUTH_REQUIRED`. |
| `optional` | No token → anonymous **read-only** session. A presented token is still verified. |
| anything else | Refused; the gateway enforces `required` and logs a warning. |

Invariants in every mode:

- **No downgrade.** An invalid (`WS_AUTH_INVALID`) or expired (`WS_AUTH_EXPIRED`)
  token closes the socket with code `4401`. It never falls back to anonymous.
  If `JWT_SECRET` is unset, any presented token is rejected.
- **Anonymous = read-only.** Anonymous sessions may `subscribe` / `unsubscribe`
  only. Actions with side effects (`swap` cache invalidation) return
  `WS_FORBIDDEN`.
- **Lower cap for anonymous.** `WS_POOL_UPDATES_ANON_MAX_SUBSCRIPTIONS`
  (default 10, never above `PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT`, default 50).
- **Mainnet gate.** `optional` on `STELLAR_NETWORK=mainnet` also requires
  `WS_POOL_UPDATES_ANON_MAINNET_ENABLED=true`; otherwise `required` is enforced.
- **Input bounds.** Frames over 4 KiB are dropped; `poolId` must match
  `[A-Za-z0-9._:-]{1,128}` or the client gets `WS_INVALID_REQUEST`.
- **Idempotent subscribe.** Re-subscribing to a held pool is a no-op.
- **Correlation.** A safe client `x-correlation-id` handshake header is echoed
  in every error frame; otherwise one is generated.
- **Observability.** Counter `ws_pool_updates_auth_outcomes` (fixed labels:
  `connected_wallet`, `connected_anonymous`, `rejected_auth_*`,
  `forbidden_action`, `subscription_limit`). Logs carry the correlation id and
  code, never the token.

Rollback: unset `WS_POOL_UPDATES_AUTH_MODE` (or set it to `required`) and
restart. No data migration is involved.

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
