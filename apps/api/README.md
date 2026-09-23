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

- Keep changes scoped; do not refactor unrelated modules.
- Add unit tests for invariants and auth negatives, and integration/e2e coverage
  on the critical path.
- Update this README and any affected runbooks when behavior changes.
- Land money-path or mainnet-affecting changes behind a flag and document the
  rollback in the PR description.
