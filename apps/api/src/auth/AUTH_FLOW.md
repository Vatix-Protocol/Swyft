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
