# Swyft

Swyft is the liquidity, trading, and settlement surface of the Vatix-Protocol
monorepo. This repository ships the API service, the web client, and the
supporting infrastructure used to run them locally and in production.

## Repository layout

- `apps/api/` — the Swyft API service (HTTP + workers).
- `apps/web/` — the Swyft web client.
- `docker-compose.yml` — root compose file that orchestrates the full local stack.
- `apps/api/docker-compose.yml` — API-local compose file for running just the API and its dependencies.
- `turbo.json` — Turborepo pipeline and remote cache configuration (source of truth for cache policy).

## Local Docker / Compose

There are two compose files in this repo. They serve different purposes and are
not interchangeable. Use the one that matches what you are trying to run.

### Root `docker-compose.yml` — full stack

Purpose: orchestrate the complete local stack (API, web, database, cache, and
any supporting services) with shared networks and volumes. Use this when you
want to exercise the end-to-end product locally.

```bash
# from the repository root
docker compose up --build
```

Expected endpoints (defaults):

- Web client: http://localhost:3000
- API: http://localhost:8000
- API health: http://localhost:8000/health

### `apps/api/docker-compose.yml` — API-local

Purpose: run only the API service and the dependencies it needs (database,
cache) for focused API development and debugging. Use this when you are working
on the API alone and do not need the web client or the rest of the stack.

```bash
# from apps/api
cd apps/api
docker compose up --build
```

Expected endpoints (defaults):

- API: http://localhost:8000
- API health: http://localhost:8000/health

### How they relate

- The root compose file is the source of truth for the full local stack.
- The API-local compose file is a subset: it defines the API service and its
  direct dependencies only.
- Where the two files overlap (API service name, API port, API environment
  variable names, and the database/cache service names), they are kept
  consistent so that switching between them does not change how the API is
  configured.
- Intentional differences: the root file additionally defines the web client
  and any stack-wide services, and it owns the shared network/volume topology
  for the full stack. The API-local file does not define the web client.

If you change a shared value (API port, API env var name, database/cache
service name), update both compose files in the same change so they stay in
sync.

## Turbo remote cache policy

`turbo.json` is the source of truth for the Turborepo pipeline and remote cache
configuration. This section documents the policy that `turbo.json` encodes so
contributors and CI behave consistently. If this section and `turbo.json`
disagree, `turbo.json` wins — update this section in the same change that edits
`turbo.json`.

### What is cached

- Only task outputs declared in `turbo.json` (`outputs`) are cached. Tasks with
  no declared outputs cache their logs/exit status only.
- Build artifacts, generated clients, and compiled bundles are cacheable.
- Secrets, `.env` files, credentials, and anything under git-ignored local
  paths are never cacheable outputs and must not be declared as `outputs`.

### Cache key inputs

A cache hit requires all of the following to match:

- The task definition in `turbo.json` (command, `inputs`, `outputs`, `env`,
  `dependsOn`).
- The contents of the files matched by `inputs` (defaults to the package's
  tracked source files).
- The values of environment variables listed in the task's `env` (and
  `globalEnv` / `globalDependencies` where configured).
- The resolved dependency graph and the lockfile / dependency versions.

Changing any input above is a cache miss by design. Do not work around a miss
by disabling inputs; fix the task definition instead.

### Remote cache auth expectations

- The remote cache is an optimization, not a source of truth. It is only
  reachable with a valid token supplied via the environment (for example
  `TURBO_TOKEN` plus `TURBO_TEAM`/`TURBO_REMOTE_CACHE_*` as configured in CI).
- Tokens are provided by CI secrets or a developer's local, git-ignored
  environment. Never commit tokens, never echo them in logs, and never bake
  them into cached artifacts.
- Cache access is deny-by-default: without valid credentials, Turbo must fall
  back to local execution rather than reading or writing the remote cache.
- Privileged cache surfaces (writing to a shared/team cache, or any cache used
  by release/mainnet-affecting pipelines) require an authenticated, authorized
  identity. Untrusted clients must not be able to read or poison these entries.

### Fail-closed behavior

- If the remote cache is unavailable (network error, auth expiry, outage), the
  build must fail closed on writes: do not publish partial or unverified
  artifacts to the remote cache, and do not treat a cache miss as success for
  money-path or release tasks.
- Reads may degrade to local execution, but the resulting artifacts must be
  produced by the same task definition and inputs as a cache hit would have
  required.
- CI must not silently pass when the remote cache is misconfigured for a
  required job; surface the failure instead of masking it.

### Security considerations

- No secrets in the repo or in logs. Cache keys and logs must not contain
  tokens, credentials, or customer data.
- Deny-by-default for new privileged cache surfaces; adding a new writable
  cache scope requires an explicit, reviewed change.
- The server/contract remains the source of truth for balances, swaps, and
  admin actions. A cache hit never authorizes a money-path action and never
  substitutes for server-side validation.

### Edge cases and failure modes

- Cache poisoning / adversarial input: treat cache contents as untrusted. A
  cache entry must be reproducible from the declared inputs; if it cannot be
  verified, discard it and rebuild.
- Dependency outage (RPC/DB/Redis or the remote cache itself): fail closed on
  writes and fall back to local execution for reads.
- Auth expiry / wrong role: treat as unauthenticated — fall back to local
  execution and do not write to the remote cache.
- Testnet vs mainnet separation: testnet and mainnet builds must not share
  cache scopes. Keep environment-specific values in `env` so a testnet artifact
  can never satisfy a mainnet cache key.
- Concurrent/replayed requests: cache writes must be idempotent for a given key;
  a replayed write must not corrupt an existing entry.

## Development

See `apps/api/README.md` for API-specific setup, and `apps/web/README.md` for
web client setup. For local Docker usage, prefer the compose guidance above.

## Security

See `SECURITY.md` for reporting and policy. Do not commit secrets; local
compose files must read credentials from environment variables or local
`.env` files that are git-ignored.
