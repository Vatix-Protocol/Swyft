# Indexer Dead-Letter Replay

Runbook and contract for `POST /v1/indexer/dead-letters/replay`. Tracking
issue: #1026.

Code:

- `apps/api/src/indexer/dlq-replay.guard.ts` — authz, kill switch, rate limit
- `apps/api/src/indexer/dto/replay-dead-letter.dto.ts` — input contract
- `apps/api/src/indexer/indexer-replay.service.ts` — `replayDeadLettersIdempotent`
- Tests: `apps/api/src/indexer/dlq-replay.e2e.spec.ts`

Replay re-enqueues pool, swap, position and fee projections. That makes it a
**money-path write surface**, even though the chain stays the source of truth.

## Enabling

Replay is **off by default**.

| Variable | Required value | Purpose |
| --- | --- | --- |
| `INTERNAL_API_KEY` | non-placeholder secret | credential (`x-internal-key`) |
| `INDEXER_DLQ_REPLAY_ENABLED` | `true` | kill switch |
| `INDEXER_DLQ_REPLAY_MAINNET_ENABLED` | `true` (mainnet only) | second opt-in when `STELLAR_NETWORK=mainnet` |
| `INDEXER_DLQ_REPLAY_MAX_PER_MINUTE` | 1–1000 (default 10) | per-process rate limit |

Key rotation follows [`INTERNAL_KEY_ROTATION.md`](INTERNAL_KEY_ROTATION.md).
The `_PREVIOUS` slot is honoured until it expires.

## Request

```bash
curl -X POST https://api.example/v1/indexer/dead-letters/replay \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  -H "x-idempotency-key: incident-4711-job-123" \
  -H "x-correlation-id: incident-4711" \
  -H "content-type: application/json" \
  -d '{"jobId":"job-123"}'      # or '{}' to replay all unrecovered (max 500)
```

Optional headers: `x-dlq-replay-role: indexer-operator`, and
`x-dlq-replay-expires-at: <epoch ms>` for scoped, short-lived automation
credentials.

Response (`201`):

```json
{ "replayed": ["job-123"], "skipped": [], "total": 1,
  "correlationId": "incident-4711", "deduplicated": false }
```

## Invariants

1. **Deny-by-default authz.** Only the `INTERNAL_API_KEY` ring grants replay.
   Before #1026 the route used `InternalKeyGuard`, which prefers
   `FEE_COLLECTOR_AUTH`, so a fee-collector credential could replay the DLQ.
   It can't anymore.
2. **Check order:** auth → role/expiry → kill switch → network → rate limit.
   Unauthenticated callers always get 401 and learn nothing about flag state.
3. **Idempotency.**
   - Concurrent requests for the same target and key share one execution.
   - With an explicit `x-idempotency-key`, a retry within 10 minutes returns
     the original result (`deduplicated: true`) without re-enqueueing. The key
     is scoped to the target (`jobId` or "all"), so it cannot be reused to
     replay a different job.
   - Without a key, a repeated request really does run again. BullMQ job ids
     are stable (`dlq-replay:<jobId>`) and handlers upsert on `eventId`, so
     balances and TVL are never double-applied.
   - Failures are never cached, so a retry after an outage runs again.
4. **Fail-closed.** If the dead-letter store (Postgres) is unreachable, the
   request returns `503 DLQ_REPLAY_DEPENDENCY_UNAVAILABLE`. Nothing is
   enqueued and nothing is marked recovered. Before #1026 an outage looked
   like an empty DLQ (`total: 0`) or a missing job (404).
5. **Adversarial input.** `jobId` and `x-idempotency-key` must match
   `[A-Za-z0-9._:-]{1,128}`. This blocks log forging and oversized ids.
6. **No secrets in logs or metrics.** Logs record correlation id, denial reason
   and key slot (`current` / `previous`), never key material.

## Stable error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `DLQ_REPLAY_AUTH_MISSING_KEY` | no `x-internal-key` |
| 401 | `DLQ_REPLAY_AUTH_INVALID_KEY` | key does not match the INTERNAL_API_KEY ring |
| 401 | `DLQ_REPLAY_AUTH_EXPIRED` | previous-slot key past its window, or `x-dlq-replay-expires-at` in the past or invalid |
| 401 | `DLQ_REPLAY_AUTH_NOT_CONFIGURED` | `INTERNAL_API_KEY` unset (fail-closed) |
| 403 | `DLQ_REPLAY_AUTH_WRONG_ROLE` | `x-dlq-replay-role` is not `indexer-operator` |
| 403 | `DLQ_REPLAY_AUTH_DISABLED` | kill switch off |
| 403 | `DLQ_REPLAY_AUTH_MAINNET_DISABLED` | mainnet without the mainnet opt-in |
| 429 | `DLQ_REPLAY_AUTH_RATE_LIMITED` | over `INDEXER_DLQ_REPLAY_MAX_PER_MINUTE`; honour `retryAfterMs` |
| 400 | `DLQ_REPLAY_INVALID_IDEMPOTENCY_KEY` | malformed `x-idempotency-key` |
| 404 | `DLQ_REPLAY_NOT_FOUND` | unknown `jobId` |
| 503 | `DLQ_REPLAY_DEPENDENCY_UNAVAILABLE` | DLQ store down; nothing replayed |

Every error body includes `correlationId`.

## Observability

- `indexer_dlq_replay_auth_outcomes`: `allowed`, `missing`, `invalid`,
  `not_configured`, `previous_expired`, `wrong_role`, `expired`, `disabled`,
  `mainnet_disabled`, `rate_limited`.
- `indexer_dlq_replay_outcomes`: `replayed`, `deduplicated`, `not_found`,
  `dependency_unavailable`, `failed`.
- `internal_key_auth_outcomes` gains the `dlq_replay:*` series.

Alert on repeated `invalid` (someone is probing) and on
`dependency_unavailable`.

## Rollback

- **Kill switch:** set `INDEXER_DLQ_REPLAY_ENABLED=false` and restart. Every
  call returns 403 `DLQ_REPLAY_AUTH_DISABLED`.
- **Code rollback:** reverting restores the old `InternalKeyGuard` behaviour,
  where replay is always enabled and FEE_COLLECTOR_AUTH is accepted.
  Prefer the kill switch.

## Deploy note

This changes the default. Replay was implicitly enabled before; it is now off
until `INDEXER_DLQ_REPLAY_ENABLED=true` is set. Operators who rely on replay
must set the flag when they deploy.
