# Contributing to Swyft

Thanks for contributing to Swyft (Vatix-Protocol). This guide covers the
required local checks and the conventions we expect in pull requests.

## Prerequisites

- Node.js (see `.nvmrc` / `package.json` `engines` if present)
- pnpm (workspace package manager)
- Docker + Docker Compose (for local services)

## Getting started

```bash
pnpm install
```

## Required checks: Prettier and ESLint

Formatting and linting are **required** for all apps. CI fails closed: a pull
request with Prettier or ESLint violations will not pass required checks.

Configs are the source of truth:

- Root Prettier config: `.prettierrc` (with `.prettierignore`)
- App ESLint config, e.g. `apps/api/eslint.config.mjs`

### Commands

Run these from the repository root unless noted:

```bash
# Format all files
pnpm format

# Check formatting without writing (used by CI)
pnpm format:check

# Lint all apps
pnpm lint

# Lint a single app (example: api)
pnpm --filter api lint
```

If a script is not defined at the root, run the equivalent inside the app
directory (for example `apps/api`):

```bash
cd apps/api
pnpm lint
pnpm format:check
```

### Fixing violations

```bash
# Auto-fix formatting
pnpm format

# Auto-fix lint issues where possible
pnpm lint --fix
```

Commit the resulting changes. Do not disable rules inline to bypass CI; if a
rule is genuinely wrong, open an issue to discuss changing the config.

## Git hooks

Husky hooks run automatically:

- `.husky/pre-commit` — formats/lints staged files
- `.husky/pre-push` — runs the full lint/format check

Do not use `--no-verify` to skip hooks. CI enforces the same checks, so skipped
hooks will still fail the pull request.

## Turbo remote cache policy

Swyft uses Turborepo. `turbo.json` is the **source of truth** for the task graph
and cache policy; this section documents the invariants contributors must
respect. If this section and `turbo.json` ever disagree, `turbo.json` wins —
update this doc in the same PR that changes the config.

### What is cached

- Only task outputs declared in `turbo.json` (`outputs`) are cached. Tasks with
  no declared outputs cache only their logs/exit status.
- Tasks marked `"cache": false` (for example dev servers or anything with
  side effects) are never cached and must stay that way.
- Cache artifacts are build/test outputs only. Never place secrets, `.env`
  files, credentials, or tokens in a task's `outputs`.

### Cache key inputs

A cache hit requires an identical key. The key is derived from:

- The task name and the package's source files (per `inputs`, or all tracked
  files when `inputs` is unset).
- Resolved dependency task hashes (the `dependsOn` graph).
- Relevant environment variables declared in `turbo.json` (`env` / `globalEnv`).
- The lockfile and `turbo.json` itself.

If a task's behavior depends on an environment variable, declare it in
`turbo.json` so it participates in the key. Undeclared env vars cause stale
cache hits — treat that as a bug, not a convenience.

### Remote cache auth

- The remote cache is an optimization, not a trust boundary. Access is
  deny-by-default: only CI and authorized maintainers may read or write it.
- Credentials (`TURBO_TOKEN`, `TURBO_TEAM`, registry tokens) are injected via
  CI secrets or the local environment. **Never** commit them, echo them, or
  print them in logs. Do not add them to `turbo.json`, `outputs`, or any
  committed file.
- Untrusted clients (forks, external PRs) must not be able to write to the
  shared remote cache. Keep write access scoped to trusted CI contexts.

### Fail-closed behavior

- A remote cache outage must never change correctness. If the remote cache is
  unreachable, tasks fall back to a local run; builds and tests still execute
  and must pass on their own merits.
- Never treat a cache miss or cache error as success. Do not add fallbacks that
  skip tests, lint, or type checks when the cache is unavailable.
- Money-path and mainnet-affecting tasks must remain reproducible from source
  alone; the cache only speeds them up.

### Edge cases

- **Cache poisoning / adversarial input:** only trusted CI writes to the shared
  cache. Treat cache contents as untrusted input — never execute cached
  artifacts as privileged, and never source secrets from them.
- **Dependency outage:** if the remote cache (or its backing store) is down,
  fail closed on writes and fall back to local execution; do not silently skip
  required checks.
- **Testnet vs mainnet separation:** cache keys must not collide across
  environments. Keep environment-specific values in declared env vars so
  testnet and mainnet artifacts never share a cache entry.

### Security

- No secrets in the repo, in `turbo.json`, or in logs.
- Deny-by-default for any new privileged cache surface (new writers, new
  tokens, new scopes).
- The server/contract remains the source of truth for balances, swaps, and
  admin. The cache never holds authoritative state for money paths.

## Pull requests

1. Branch from `main` and keep changes scoped to the issue.
2. Ensure `pnpm lint` and `pnpm format:check` pass locally.
3. Update docs/runbooks when behavior changes.
4. Describe rollback/flag strategy for any money-path or mainnet-affecting change.

## Security

- Never commit secrets or tokens.
- Server/contract remains the source of truth for balances, swaps, and admin.
- Authorize and rate-limit every external entrypoint; deny by default for new
  privileged surfaces.

See `SECURITY.md` for reporting vulnerabilities.
