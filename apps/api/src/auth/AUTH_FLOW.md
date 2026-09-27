# Auth Flow

This document describes how authentication and authorization work for the Swyft API
surface. It is the canonical reference for entrypoint policy and is cross-linked from
the transport decision in [`docs/GRAPHQL_VS_TRPC_SPIKE.md`](../../../docs/GRAPHQL_VS_TRPC_SPIKE.md)
and the implementation guide in [`docs/TRPC-IMPLEMENTATION.md`](../../../docs/TRPC-IMPLEMENTATION.md).

## Transport

tRPC is the canonical transport for the Swyft API (see the recorded decision in
`docs/GRAPHQL_VS_TRPC_SPIKE.md`). GraphQL is not used for money-path or admin
surfaces. Authz rules below apply to every tRPC procedure regardless of transport
adapter.

## Principles

- **Deny by default.** Every external entrypoint is authenticated and authorized
  unless it is explicitly listed as public. New privileged surfaces start closed.
- **Server is the source of truth.** Balances, swaps, and admin state are decided
  server-side (and on-chain where applicable); clients never assert authoritative
  values.
- **Fail closed on writes.** If a dependency (RPC, DB, Redis) is unavailable, write
  paths reject rather than partially apply.
- **No secrets in repo or logs.** Tokens, keys, and credentials are never logged or
  committed; logs carry correlation ids and stable error codes only.

## Authentication

1. The client obtains a session/credential via the configured auth provider.
2. Requests carry the credential on every tRPC call; the server validates it before
   any handler runs.
3. Expired or malformed credentials are rejected with a stable error code
   (`UNAUTHENTICATED`) and a correlation id for tracing.

## Authorization

- Each procedure declares its required role/scope. Missing or wrong role returns
  `FORBIDDEN` (stable code) and is logged without sensitive payloads.
- Admin and money-path procedures require an explicit privileged role; there is no
  implicit elevation and no client-side bypass.
- Untrusted clients cannot reach privileged handlers by omitting or spoofing fields;
  the server re-derives identity and policy on every request.

## Current-wallet decorator

REST handlers get the caller's wallet only through `@CurrentWallet()` /
`@CurrentWalletPrincipal()` ([`current-wallet.decorator.ts`](./current-wallet.decorator.ts)).
Trust boundary invariants (#1033):

- **Single trusted source.** The decorator reads the principal that
  `JwtAuthGuard` stores with `attachWalletPrincipal` ([`wallet-principal.ts`](./wallet-principal.ts))
  after verifying the JWT. `req.user`, `req.wallet`, headers, query and body
  are never trusted, so middleware or a client cannot choose whose wallet a
  handler acts on.
- **Fail-closed.** A route that forgot the guard, or a token whose wallet
  claim is not a valid Stellar ed25519 public key (`G...`), is rejected with
  401 before the handler runs.
- **Deny-by-default authz.** `@CurrentWallet({ scopes, roles })` requires every
  listed scope and at least one listed role, otherwise 403.
- **Network-agnostic.** A `G...` key is the same on testnet and mainnet;
  network selection stays in server config (`STELLAR_NETWORK`), never the token.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `AUTH_MISSING_WALLET` | 401 | No guard-verified principal on the request |
| `AUTH_INVALID_WALLET` | 401 | Wallet claim is not a valid Stellar public key |
| `AUTH_INSUFFICIENT_SCOPE` | 403 | A required scope is missing |
| `AUTH_INSUFFICIENT_ROLE` | 403 | None of the allowed roles is granted |

Every error body is `{ code, message, correlationId }` and never echoes the
token or wallet. Outcomes are counted in `GET /metrics/security` →
`currentWallet` (fixed label set).

## Idempotency & replay

- Mutating money-path procedures accept an idempotency key. Concurrent or replayed
  requests with the same key resolve to a single effect.
- Replays after success return the original result rather than re-applying.

## Failure modes

| Condition | Behavior |
| --- | --- |
| RPC/DB/Redis outage on write | Fail closed; return stable error code, no partial write |
| Auth expiry | Reject with `UNAUTHENTICATED` |
| Wrong role | Reject with `FORBIDDEN` |
| Adversarial/griefing input | Validate and rate-limit; reject without leaking internals |
| Testnet vs mainnet drift | Resolve network/address from server config, never from client input |

## Observability

- Every request is tagged with a correlation id propagated through logs and metrics.
- Errors use stable, documented codes; messages never include secrets or raw
  credentials.
- Money-path procedures emit metrics suitable for alerting without exposing
  sensitive values.

## Feature flags & rollback

Money-path or mainnet-affecting changes land behind a feature flag / kill-switch.
Disabling the flag restores prior behavior without a redeploy of dependent services.
Rollback steps are documented in the corresponding PR description.

## Related docs

- [`docs/GRAPHQL_VS_TRPC_SPIKE.md`](../../../docs/GRAPHQL_VS_TRPC_SPIKE.md) — recorded transport decision
- [`docs/TRPC-IMPLEMENTATION.md`](../../../docs/TRPC-IMPLEMENTATION.md) — tRPC implementation guide
- [`SECURITY.md`](../../../SECURITY.md) — security policy and reporting
- [`docs/INTERNAL_KEY_ROTATION.md`](../../../docs/INTERNAL_KEY_ROTATION.md) — `x-internal-key` rotation runbook
