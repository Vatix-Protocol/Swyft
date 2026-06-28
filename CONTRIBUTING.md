# Contributing to Swyft

Thanks for your interest in contributing. Swyft is built almost entirely by external contributors — the maintainer handles architecture decisions, PR reviews, and releases. Contributors handle features.

**Pick up an issue and open a PR — that's it.**

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Finding Work](#finding-work)
- [Branch and Commit Conventions](#branch-and-commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Issue Labels](#issue-labels)

---

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/Swyft.git
   cd Swyft
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/Valreb001/Swyft.git
   ```
4. Follow the [Development Setup](#development-setup) section below.

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| pnpm | ≥ 8 | `npm install -g pnpm` |
| Rust | stable | `rustup toolchain install stable` |
| stellar-cli | latest | See [Stellar docs](https://developers.stellar.org/docs/smart-contracts/getting-started/setup) |
| Docker | any | For local Postgres + Redis |

### Install dependencies

```bash
pnpm install
```

### Configure environment

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — see Environment Variables section in README
```

### Start local services (Postgres + Redis)

```bash
cd apps/api
docker compose up -d
```

### Run the full stack

```bash
pnpm dev
```

This starts the NestJS API and Next.js dApp simultaneously via Turborepo.

### Run contract tests

```bash
cd packages/contract
cargo test --workspace
```

### Run API tests

```bash
pnpm --filter api test
```

---

## Finding Work

- Browse [open issues](https://github.com/Valreb001/Swyft/issues)
- Issues labelled [`good first issue`](https://github.com/Valreb001/Swyft/issues?q=label%3A%22good+first+issue%22) are well-scoped and don't require deep protocol knowledge
- Issues labelled [`bounty`](https://github.com/Valreb001/Swyft/issues?q=label%3Abounty) have a financial reward attached
- Comment on an issue before starting work to avoid duplication

---

## Branch and Commit Conventions

Branch names follow the pattern:

```
<type>/<short-description>
```

Examples: `feat/multi-hop-router`, `fix/pool-tick-overflow`, `docs/update-readme`

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <short description>

[optional body]

[optional footer: closes #<issue>]
```

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`

Examples:
```
feat(contracts): add tick spacing to pool factory
fix(api): prevent duplicate nonce consumption
docs: add CONTRIBUTING.md
```

---

## Pull Request Process

1. Branch from `main`:
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feat/your-feature
   ```
2. Make your changes, including tests.
3. Ensure CI passes locally:
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```
4. Push your branch and open a PR against `main`.
5. Fill in the PR template — summary, testing steps, linked issue.
6. One maintainer approval is required to merge.
7. PRs are **squash-merged** — keep your commit history clean but it isn't strictly required.

---

## Code Standards

- **TypeScript**: Strict mode enabled. No `any` without a comment explaining why.
- **Rust**: `cargo clippy` must pass with no warnings. Follow standard Rust idioms.
- **Formatting**: Run `pnpm format` before committing. Prettier config is at `.prettierrc`.
- **Linting**: Run `pnpm lint` before committing. ESLint config is in each app/package.
- **Accessibility**: Frontend components must meet WCAG 2.1 AA. Use semantic HTML and ARIA attributes where needed.

---

## Testing

| Layer | How to run | Expectation |
|---|---|---|
| Soroban contracts | `cargo test --workspace` in `packages/contract` | All tests pass |
| NestJS API unit | `pnpm --filter api test` | All tests pass |
| NestJS API e2e | `pnpm --filter api test:e2e` | Requires running Postgres + Redis |
| TypeScript SDK | `pnpm --filter @swyft/sdk test` | All tests pass |

New features **must** include tests. Bug fixes **should** include a regression test.

---

## Issue Labels

| Label | Meaning |
|---|---|
| `good first issue` | No deep protocol knowledge needed |
| `bounty` | Financial reward attached |
| `contracts` | Soroban / Rust work |
| `backend` | NestJS / API work |
| `frontend` | Next.js / React work |
| `sdk` | TypeScript SDK work |
| `docs` | Documentation |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |

---

## Questions?

Open a [GitHub Discussion](https://github.com/Valreb001/Swyft/discussions) — the maintainer and community are there to help.
