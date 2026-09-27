# Internal Key Rotation Runbook

Covers the shared secrets presented in the `x-internal-key` header:

| Ring | Protects |
| ---- | -------- |
| `INTERNAL_API_KEY` | `/admin/*` analytics, indexer replay, `/metrics/*`, the internal rate-limit tier. Also the fee-collector guard when `FEE_COLLECTOR_AUTH` is unset |
| `FEE_COLLECTOR_AUTH` | Fee-collector entrypoints (`InternalKeyGuard`); takes precedence over `INTERNAL_API_KEY` whenever it is defined |
| `TESTNET_REDEPLOY_AUTH` | Testnet wasm-hash redeploy (`TestnetRedeployGuard`) |

Implementation: [`apps/api/src/admin/internal-key-ring.ts`](../apps/api/src/admin/internal-key-ring.ts),
used by [`internal-key.guard.ts`](../apps/api/src/admin/internal-key.guard.ts),
[`metrics.controller.ts`](../apps/api/src/metrics/metrics.controller.ts) and
[`rate-limit.middleware.ts`](../apps/api/src/rate-limit/rate-limit.middleware.ts).

## Model

Each ring has at most two slots:

| Variable | Meaning |
| -------- | ------- |
| `<RING>` | Current key. Required; with no current key every request is denied (`*_NOT_CONFIGURED`) |
| `<RING>_PREVIOUS` | Old key, accepted **only** during the rotation window |
| `<RING>_PREVIOUS_EXPIRES_AT` | ISO-8601 end of the window, e.g. `2026-10-01T12:00:00Z` |

Invariants:

- **Fail-closed.** A previous key with a missing, unparseable or past expiry is
  rejected (`*_EXPIRED`). Rings never share slots: `INTERNAL_API_KEY_PREVIOUS`
  is never accepted by the fee-collector guard while `FEE_COLLECTOR_AUTH` is set.
- **Constant-time.** Both slots are always compared on SHA-256 digests, so
  timing leaks neither key length nor whether a window is open.
- **No secrets in logs, metrics or Redis.** Logs and metrics carry only the
  slot (`current`/`previous`) or denial reason. Rate-limit buckets are
  `internal:current` / `internal:previous`, not the raw key (previously the
  raw key was part of the Redis key name).
- **Boot validation (production).** The API refuses to start if a
  `_PREVIOUS` key equals the current key, is the `.env.example` placeholder,
  has no valid `_PREVIOUS_EXPIRES_AT`, or if the window ends more than 7 days
  after boot, or if `_PREVIOUS_EXPIRES_AT` is set without `_PREVIOUS`.

## Procedure

Rotation is a config change applied by a deploy/restart, so replaying a step
is harmless (idempotent).

1. **Generate** a new key in the secret manager (≥32 random bytes). Never
   paste it into tickets, chat, or the repo.
2. **Open the window.** Set on every API instance:
   ```bash
   INTERNAL_API_KEY=<new>
   INTERNAL_API_KEY_PREVIOUS=<old>
   INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT=<now + ≤7 days, ISO-8601>
   ```
   Roll out the deploy. Both keys now work.
3. **Move callers** (indexer replay jobs, metrics scrapers, ops scripts) to
   the new key.
4. **Watch** `GET /metrics/security` → `internalKeyAuth`. When
   `<surface>:previous` stops increasing, every caller has moved. The API
   also logs one warning per process the first time the previous key is used.
5. **Close the window.** Remove `INTERNAL_API_KEY_PREVIOUS` and
   `INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT` and deploy. If you forget, the old
   key stops working at `_PREVIOUS_EXPIRES_AT` anyway.

The same steps apply to `FEE_COLLECTOR_AUTH` and `TESTNET_REDEPLOY_AUTH`.

## Emergency revocation (leaked key)

Skip the window: set `<RING>` to a new key and **do not** set `_PREVIOUS`.
The leaked key is rejected as soon as the deploy completes. To end an open
window early, remove `_PREVIOUS` or set `_PREVIOUS_EXPIRES_AT` to a past
time (the runtime rejects it; production boot flags the stale value, so
prefer removing it).

## Rollback

If callers break after step 2, the old key still works; fix the callers or
revert the deploy. After step 5, rollback means re-opening the window with
the old key as `_PREVIOUS` (only if it was not leaked).

## Metrics

`GET /metrics/security` (requires `x-internal-key`) returns
`internalKeyAuth` counters labelled `<surface>:<outcome>`, where `surface` is
`fee_collector | testnet_redeploy | metrics` and `outcome` is
`current | previous | not_configured | missing | invalid | previous_expired`.
The label set is fixed; no request data ever becomes a label.
