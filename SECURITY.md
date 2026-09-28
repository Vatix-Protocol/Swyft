# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Swyft, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Use one of the following private disclosure channels:

| Channel | Address / Link |
| ------- | -------------- |
| GitHub private advisory | [Report a vulnerability](https://github.com/Vatix-Protocol/Swyft/security/advisories/new) (preferred — creates a tracked, private thread) |
| Security e-mail | security@vatixprotocol.com |

Include the following in your report:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected components, versions, or endpoints
- Any suggested remediation

We aim to acknowledge reports within **48 hours** and provide a remediation timeline within **5 business days**.

PGP-encrypted mail is accepted. The public key is available at [https://vatixprotocol.com/.well-known/security.asc](https://vatixprotocol.com/.well-known/security.asc) and on Ubuntu Keyserver (`security@vatixprotocol.com`, key ID `0xDEADBEEF`). Encryption is optional but appreciated for high-severity reports.

> **Out-of-band escalation:** If a report is not acknowledged within 48 hours, contact the lead maintainer directly via GitHub (`@vatix-lead`) with "SECURITY" in the subject. Do not disclose the vulnerability publicly before a fix is coordinated.

## Supported Versions

Security fixes are applied to the latest release on the default branch. Older releases are not maintained.

## Security Model

Swyft is a non-custodial interface to the Stellar network. The following invariants hold across all deployments:

- **The server and on-chain contracts are the source of truth** for balances, swaps, settlement, and admin state. Client-supplied values are never trusted for money-path decisions.
- **Deny-by-default** for every privileged surface. New admin, deploy, or ops entrypoints must be explicitly authorized before they are reachable.
- **Fail-closed on writes.** If a required dependency (RPC, database, Redis) is unavailable, write operations are rejected rather than silently degraded.
- **No secrets in the repository or logs.** Credentials, keys, and tokens are supplied via environment variables and are never logged or committed.
- **Every external entrypoint is authenticated and rate-limited.** Untrusted clients cannot bypass policy by replaying, forging, or racing requests.

## Architecture and Trust Boundaries

For the monorepo layout, package responsibilities, and the trust boundaries between the web client, API, and on-chain contracts, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). That document is the canonical overview; this policy describes the security controls that enforce its boundaries.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, packages, and data flows across the monorepo.
- [`docs/THREAT_MODEL_CL_DEX.md`](docs/THREAT_MODEL_CL_DEX.md) — assets, trust boundaries, threats, controls, and release checklist for the concentrated-liquidity DEX.
- [`README.md`](README.md) — project overview and contributor entrypoint.
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — on-chain contract interfaces and the source-of-truth guarantees they provide.

## API Transport Decision (GraphQL vs tRPC)

The canonical API transport for Swyft is **tRPC**. This decision is recorded in [`docs/GRAPHQL_VS_TRPC_SPIKE.md`](docs/GRAPHQL_VS_TRPC_SPIKE.md) and the implementation is described in [`docs/TRPC-IMPLEMENTATION.md`](docs/TRPC-IMPLEMENTATION.md). GraphQL is the rejected alternative and is not a supported transport; any copy implying GraphQL is canonical is out of date.

The transport decision does not weaken the security model above. The following invariants apply to every tRPC entrypoint:

- **Server/contract remains the source of truth** for balances, swaps, settlement, and admin state. Procedures never trust client-supplied balances or authorization claims.
- **Deny-by-default authz.** Every procedure declares its required scope; unauthenticated or wrong-role callers are rejected. There is no unauthenticated path to a privileged procedure.
- **Idempotency for concurrent/replayed requests.** Money-path mutations accept an idempotency key; concurrent or replayed requests with the same key are deduplicated and do not re-execute side effects.
- **Fail-closed writes.** If RPC, database, or Redis is unavailable, write procedures fail closed rather than proceeding on partial or unverified state.
- **Auth expiry / wrong role.** Expired, missing, or wrong-role credentials are rejected with stable error codes and a correlation id.
- **No secrets in repo or logs.** Procedure inputs, outputs, and logs never include credentials, keys, or tokens.

See [`apps/api/src/auth/AUTH_FLOW.md`](apps/api/src/auth/AUTH_FLOW.md) for the authentication and authorization flow that backs these invariants.

## Contract AUTH Matrix (Pool / Router / Factory)

The pool, router, and factory contracts expose privileged surfaces that must be authorized deny-by-default. The authoritative roles × actions matrix — including which role may call each entrypoint, the required scope, and the stable error code returned on denial — is defined in [`docs/CONTRACTS.md`](docs/CONTRACTS.md) under "Contract AUTH Matrix". That matrix is the source of truth for contract authorization; this section records the security controls that enforce it.

- **Deny-by-default.** Every privileged pool/router/factory entrypoint requires an explicit role. There is no unauthenticated or default-allow path to a privileged action.
- **Server/contract is the source of truth.** Authorization decisions are made server-side / on-chain; client-supplied role or admin claims are never trusted.
- **Stable error codes + correlation ids.** Authorization failures (missing role, wrong role, expired credential) return stable error codes with a correlation id so incidents are traceable without leaking internal detail.
- **Idempotency.** Money-path mutations on these contracts accept an idempotency key; concurrent or replayed requests with the same key are deduplicated and do not re-execute side effects.
- **Fail-closed writes.** If RPC, database, or Redis is unavailable, write operations on pool/router/factory fail closed rather than proceeding on partial or unverified state.
- **Testnet vs mainnet / address drift.** Role bindings and contract addresses are environment-scoped; a role valid on testnet is not assumed valid on mainnet, and address drift is rejected rather than silently accepted.
- **Kill-switch.** Any money-path or mainnet-affecting change to these surfaces lands behind a feature flag / kill-switch so it can be disabled without a redeploy.

## Turbo Remote Cache Policy

The monorepo uses [Turborepo](https://turbo.build/repo) for task orchestration and remote caching. [`turbo.json`](turbo.json) is the **source of truth** for the cache policy; this section records the security controls that enforce it. Any change to caching behavior must be made in `turbo.json` and reviewed against the invariants below.

### What is cached

- Only task **outputs** declared in `turbo.json` (`outputs`) are uploaded to the remote cache. Build artifacts, generated types, and test reports are cacheable; source files are not.
- Tasks that touch money paths, secrets, or environment-specific state must not be cached across environments. Cacheable tasks are limited to deterministic, reproducible build/test/lint work.
- Cache entries are content-addressed by the task's declared inputs; a task with no declared inputs is treated as non-cacheable.

### Cache key inputs

A cache key is derived from the task definition and its declared inputs. The following are part of the key and must be declared in `turbo.json`:

- The task name and command.
- The contents of all files matched by the task's `inputs` globs (including lockfiles and `turbo.json` itself).
- Environment variables explicitly listed in the task's `env` / `globalEnv` allowlist.

Environment variables **not** in the allowlist are excluded from the key and must never influence cached output. Adding a variable to the allowlist is a security-relevant change and requires review.

### Remote cache auth expectations

- The remote cache is a **privileged surface** and is deny-by-default. Access requires a scoped token supplied via environment (`TURBO_TOKEN`) and a team/remote (`TURBO_TEAM` / `remoteCache` in `turbo.json`).
- Tokens are **never** committed to the repository, embedded in `turbo.json`, or written to logs. They are injected by CI secrets or the developer's local environment only.
- Untrusted clients (forks, external PRs) must not be able to read or write the production remote cache. CI must not expose `TURBO_TOKEN` to untrusted workflows.
- Cache reads and writes are scoped per team/environment; a token valid for one environment is not assumed valid for another.

### Fail-closed behavior

- If the remote cache is unavailable (network outage, auth failure, or misconfiguration), the build **fails closed**: tasks re-run locally rather than consuming unverified or stale artifacts. A cache miss is always safe; a cache hit is only trusted when the entry is authenticated and content-addressed.
- A remote cache auth failure must not silently fall back to an unauthenticated cache. It is surfaced as an error and the task re-executes from source.
- Writes to the remote cache fail closed: if the cache cannot be reached, the task result is still produced locally and the failure is logged without leaking the token.

### Edge cases and failure modes

- **Cache poisoning / adversarial input.** Cache entries are content-addressed and authenticated; a tampered or unverifiable entry is treated as a miss and the task re-runs. Untrusted contributors cannot inject entries into the production cache.
- **Dependency outage.** If the remote cache is unreachable, builds proceed by re-running tasks locally (fail-closed on cache trust, not on the build). Money-path tasks are never satisfied from an unverified cache.
- **Testnet vs mainnet separation.** Cache keys include environment-scoped inputs; testnet and mainnet artifacts are not shared. A cache entry produced for one environment is never assumed valid for another.
- **Concurrent / replayed requests.** Cache writes are idempotent and content-addressed; concurrent writers producing the same key converge on the same entry without side effects.

### Observability

- Cache hits, misses, and auth failures are logged with the task name and a correlation id. Logs never include `TURBO_TOKEN` or other secrets.
- Cache hit/miss metrics are actionable: a sustained miss rate or auth-failure spike indicates a misconfiguration or outage and should be investigated via the ops runbooks below.

See [`docs/OPS_DEPLOYMENT.md`](docs/OPS_DEPLOYMENT.md) for fail-closed behavior on dependency outage and [`docs/DEPLOY_API.md`](docs/DEPLOY_API.md) for the CI/deploy preflight that injects cache credentials.

## Deploy and Ops Security

Deployment and operational procedures are security-sensitive. The executable runbooks define the required controls:

- [`docs/DEPLOY_API.md`](docs/DEPLOY_API.md) — API deploy runbook: preflight checks, required environment variables, verification, and rollback.
- [`docs/OPS_DEPLOYMENT.md`](docs/OPS_DEPLOYMENT.md) — ops deployment procedures: health checks, fail-closed behavior on RPC/DB/Redis outage, rollback, and kill-switch.
- [`docs/INTERNAL_KEY_ROTATION.md`](docs/INTERNAL_KEY_ROTATION.md) — rotating and revoking `x-internal-key` secrets (`INTERNAL_API_KEY`, `FEE_COLLECTOR_AUTH`, `TESTNET_REDEPLOY_AUTH`) with a bounded, fail-closed rotation window.
- [`docs/INDEXER_DLQ_REPLAY.md`](docs/INDEXER_DLQ_REPLAY.md) — dead-letter replay: `INTERNAL_API_KEY`-only authz, kill switch plus a separate mainnet opt-in, rate limit, idempotency, and fail-closed on DLQ store outage.
- [`docs/WEBSOCKET_RECONNECT.md#pool-updates-authn-policy-price`](docs/WEBSOCKET_RECONNECT.md#pool-updates-authn-policy-price) — `/price` WebSocket authn policy: required by default, opt-in anonymous read-only mode, and invalid tokens never downgraded.
- [`docs/COMPRESSION.md`](docs/COMPRESSION.md) — response compression safe default
