# Candle Gap Policy

Status: production policy for the Swyft API candles processor.
Owner: Swyft API team.
Related code: `apps/api/src/candles/`.

## Purpose

Define how the API candles processor detects, classifies, and resolves gaps in
OHLCV candle series so that liquidity, trading, and settlement consumers never
observe silently corrupted or partially-filled series.

## Invariants

1. A candle series returned to a client is either **complete** for the requested
   window or explicitly marked with a gap descriptor. It is never silently
   truncated.
2. Gap detection is deterministic: the same inputs (symbol, interval, window,
   source data) always produce the same gap classification.
3. Writes are fail-closed. If the upstream source (RPC/DB/Redis) is unavailable,
   the processor refuses to persist a partial series and returns a stable error.
4. Every privileged entrypoint is deny-by-default. Untrusted clients cannot
   bypass the gap policy by supplying their own fill values.
5. Processing is idempotent per `(symbol, interval, windowStart, windowEnd)`.
   Replayed or concurrent requests converge to the same stored series.

## Gap classification

| Class            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `NONE`           | No gaps detected in the window.                                |
| `INTERPOLATED`   | Gaps filled from an approved source (previous close carry).    |
| `UNRESOLVED`     | Gaps exist and cannot be safely filled; series is rejected.    |

`UNRESOLVED` is a terminal state for a request: the processor returns an error
and does not persist the series.

## Error codes

Stable error codes are part of the public contract. Do not renumber.

| Code                       | HTTP | Meaning                                              |
| -------------------------- | ---- | ---------------------------------------------------- |
| `CANDLE_GAP_UNRESOLVED`    | 422  | Gaps could not be resolved under policy.             |
| `CANDLE_SOURCE_UNAVAILABLE`| 503  | Upstream source outage; write refused (fail-closed). |
| `CANDLE_POLICY_FORBIDDEN`  | 403  | Caller not authorized to bypass gap policy.          |
| `CANDLE_REQUEST_INVALID`   | 400  | Malformed window/interval/symbol.                    |
| `CANDLE_CONFLICT`          | 409  | Concurrent write for the same window in flight.      |

Every error response carries a `correlationId` so operators can trace the
request across logs and metrics.

## Authorization

- Reading candles is allowed for authenticated clients.
- Bypassing the gap policy (requesting raw, unfilled series or supplying fill
  values) requires the `candles:admin` role.
- Requests without the required role are rejected with
  `CANDLE_POLICY_FORBIDDEN`. There is no implicit trust for internal callers.

## Idempotency and concurrency

- Requests are keyed by `(symbol, interval, windowStart, windowEnd)`.
- A concurrent write for the same key returns `CANDLE_CONFLICT` rather than
  racing.
- Replays of a completed key return the stored series without re-fetching.

## Fail-closed behavior

- If the source is unavailable, the processor returns
  `CANDLE_SOURCE_UNAVAILABLE` and persists nothing.
- Partial series are never written. A failed window is retried as a whole.

## Observability

- Metrics: `candles.processed`, `candles.gap.detected`,
  `candles.gap.unresolved`, `candles.source.errors`, each labeled by symbol and
  interval.
- Logs include `correlationId`, symbol, interval, and window bounds. No secrets,
  tokens, or raw upstream payloads are logged.

## Rollback / kill switch

The gap policy is gated behind the `CANDLE_GAP_POLICY` feature flag. Disabling
the flag reverts to the previous pass-through behavior without a deploy. Rollback
steps are documented in the PR description for any change touching this path.

## References

- `apps/api/src/candles/` — processor and service implementation.
- `apps/api/src/auth/jwt-auth.guard.ts` — authz guard used by candle entrypoints.
