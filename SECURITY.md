# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Swyft, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email the maintainers directly or use GitHub's private vulnerability reporting feature. Include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected components, versions, or endpoints
- Any suggested remediation

We aim to acknowledge reports within 48 hours and provide a remediation timeline within 5 business days.

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

## Deploy and Ops Security

Deployment and operational procedures are security-sensitive. The executable runbooks define the required controls:

- [`docs/DEPLOY_API.md`](docs/DEPLOY_API.md) — API deploy runbook: preflight checks, required environment variables, verification, and rollback.
- [`docs/OPS_DEPLOYMENT.md`](docs/OPS_DEPLOYMENT.md) — ops deployment procedures: health checks, fail-closed behavior on RPC/DB/Redis outage, rollback, and kill-switch.

Operators must follow these runbooks exactly. Deploy entrypoints are privileged surfaces and are deny-by-default: they require an authenticated operator role and are gated behind a feature flag / kill-switch so a money-path or mainnet-affecting change can be disabled without a redeploy.

### Authorization

- Deploy and ops endpoints require a valid operator credential with the appropriate role. Requests with an expired token, missing token, or wrong role are rejected.
- Authorization failures return stable error codes and a correlation id so incidents can be traced without leaking internal detail.
- Untrusted clients cannot reach privileged surfaces; there is no unauthenticated path to deploy or ops actions.

### Idempotency and Replay

- Deploy and ops mutations accept an idempotency key. Concurrent or replayed requests with the same key are deduplicated and do not re-execute side effects.
- Correlation ids are attached to every deploy/ops request and propagated to logs and metrics for auditability.

### Fail-Closed Behavior

- If RPC, database, or Redis is unavailable, write operations fail closed. The system does not proceed with a partial or unverified state.
- Health checks distinguish liveness from readiness; a dependency outage marks the service not-ready so traffic is not routed to an unhealthy instance.

### Observability

- Deploy and ops paths emit actionable metrics and structured logs (success/failure counts, latency, dependency health) without including secrets or sensitive payloads.
- Money-path operations are instrumented so regressions are detectable.

## API Changelog Discipline

Security-relevant API changes must be recorded in the canonical changelog at [`docs/API_CHANGELOG.md`](docs/API_CHANGELOG.md). This is required so that authz, error-code, and money-path changes are auditable and so contributors can see the security impact of a change before it ships.

- Every entry records the affected endpoints/entrypoints, error codes, and the authz/scope impact of the change.
- Breaking changes and any money-path or mainnet-affecting change must be flagged and include migration and rollback notes.
- Changes that alter authentication, authorization, secret handling, or error-code semantics must be cross-referenced here and in the changelog entry.
- The changelog is the source of truth for what changed and when; contradictory copy elsewhere must be removed when a change lands.

## Rollback and Kill-Switch

Every money-path or mainnet-affecting change lands behind a feature flag or kill-switch. Rollback steps are documented in the corresponding runbook and in the PR description. Operators can disable a risky change without a redeploy.

## Scope

This policy covers the Swyft API, web client, and deployment tooling in this repository. On-chain contract security is governed by the contract audit process; report contract issues through the same private channel.
