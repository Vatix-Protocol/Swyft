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
