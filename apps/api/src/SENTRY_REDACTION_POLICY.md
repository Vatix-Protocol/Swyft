# Sentry Redaction Policy

## Overview

The Swyft API enforces a strict, deny-by-default PII redaction policy in Sentry so that wallet, auth, and secret material never leaves the process. Redaction is applied server-side in the `beforeSend` hook and cannot be disabled or overridden by any client.

## Invariants

1. **Deny-by-default**: unknown fields are treated as sensitive and redacted unless explicitly allow-listed.
2. **Fail-closed**: if the scrubber throws or exceeds its depth budget, the event is dropped rather than sent unredacted.
3. **No client opt-out**: no header, query param, or body field can disable redaction.
4. **No secrets in logs/metrics**: only counts and stable error codes are emitted.

## What Is Redacted

### Automatic Pattern Matching
- **Wallet Addresses**: Stellar addresses (56 base32 chars starting with 'G')
  - Pattern: `\bG[A-Z2-7]{55}\b`
  - Example: `GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F` -> `[REDACTED]`
- **Nonce Values**: authentication nonces (32+ hex or base64 chars)
  - Pattern: `nonce["\s:=]*:?["\s]?([a-f0-9]{32,}|[a-zA-Z0-9+/]{40,})/gi`
- **Tokens & Secrets**: keys matching `token`, `signature`, `secret`, `password`, `accessToken`, `refreshToken`, `authorization`

### Redaction Scope

Applied recursively to breadcrumbs, contexts (request/user), extra fields, request headers/body/query, exception messages, and stack-trace context values.

## What Is Kept

- Request metadata: HTTP method, path, status code, timing
- Exception class names and stack traces (sensitive values redacted)
- Tags: `requestId`, `path`, `method`
- Timestamps and correlation ids for log correlation

## Implementation

### Core Scrubber

Located in `apps/api/src/sentry.ts`:

```typescript
function redactSensitiveData(value: unknown, depth = 0): unknown
```

- Recursive, type-aware, depth-limited (max depth 50)
- On depth overflow or unexpected type, returns `[REDACTED]` (fail-closed)

### beforeSend Hook

Runs on every event before transmission. If scrubbing fails, the hook returns `null` so the event is dropped instead of leaking raw data.

## Usage

```typescript
import { setRequestContext } from './sentry';

setRequestContext(requestId, path, method, walletAddress);
```

The wallet address is tagged as `user.id` and redacted from any message or breadcrumb by the `beforeSend` hook.

## Configuration

- `SENTRY_DSN` - enables Sentry (disabled when unset)
- `NODE_ENV` - redaction applies in all environments except `test`
- `SENTRY_TRACES_SAMPLE_RATE` - trace sampling rate (default 0.1)

## Observability

Redaction emits ops-safe counters only (no payloads):
- `sentry.redaction.applied` - number of fields redacted
- `sentry.redaction.dropped` - events dropped by fail-closed path
- `sentry.redaction.error` - scrubber failures (stable error code `SENTRY_REDACTION_FAILED`)

## Testing

1. Unit tests assert wallet/nonce/token redaction and deny-by-default for unknown keys.
2. Negative tests assert a client cannot disable redaction via headers or body.
3. Fail-closed test asserts the event is dropped when the scrubber throws.

## Related Files

- `src/sentry.ts` - Sentry init and redaction logic
- `src/logging/logging.middleware.ts` - request/response logging (also redacts)
- `src/request-validation/all-exceptions.filter.ts` - global exception handler
