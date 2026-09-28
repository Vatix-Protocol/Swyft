# Contributing to Swyft

Thanks for your interest in contributing. Swyft is built almost entirely by external contributors — the maintainer handles architecture decisions, PR reviews, and releases. Contributors handle features.

**Pick up an issue and open a PR — that's it.**

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Finding Work](#finding-work)
- [Package Boundaries](#package-boundaries)
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
   git remote add upstream https://github.com/Vatix-Protocol/Swyft.git
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

### Build Soroban WASM contracts

The contract workspace targets Soroban's WASM runtime. Soroban requires Rust
1.84 or newer and its `wasm32v1-none` target. Install the target for the stable
toolchain before building; installing Rust alone does not install the WASM
standard library:

```bash
rustup update stable
rustup target add wasm32v1-none --toolchain stable
rustc +stable --version # Soroban requires Rust 1.84 or newer
rustup show
rustup target list --installed --toolchain stable
```

Build deployable, optimized contract artifacts with the Soroban CLI from the
repository root:

```bash
stellar contract build
# Equivalent workspace command:
pnpm --filter contracts build
```

The build writes `.wasm` files under `packages/contract/target/wasm32v1-none/release/`.
Use `cargo test --workspace` for Rust unit tests; it does not replace the
Soroban WASM build. For a focused test, run `cargo test -p <crate-name>` from
`packages/contract` (for example, `cargo test -p cl-pool`).

If the build reports a missing `wasm32v1-none` target, install it for
the same toolchain selected by `rustup show`. If a contract's WASM output is
stale after changing toolchains or build settings, rebuild with
`stellar contract build` before using or deploying that artifact. Do not
deploy an unoptimized debug WASM produced by a plain `cargo build`.
See [`packages/contract/README.md`](packages/contract/README.md) for contract
build, testnet deployment, and artifact details.

### Run API tests

```bash
pnpm --filter api test
```

### Run web Vitest

```bash
pnpm --filter web test
```

The CI workflow includes a dedicated web Vitest job so frontend regressions are
caught whenever changes land in `apps/web`.

### Git hooks

- **pre-commit** — runs ESLint on `apps/api`.
- **pre-push** — runs `turbo run lint` filtered to only the packages affected since `origin/main`, so the hook stays fast on a large monorepo instead of linting everything.
  - Skip it for a single push with `SWYFT_SKIP_PRE_PUSH_LINT=1 git push`.

---

## Finding Work

- Browse [open issues](https://github.com/Vatix-Protocol/Swyft/issues)
- Issues labelled [`good first issue`](https://github.com/Vatix-Protocol/Swyft/issues?q=label%3A%22good+first+issue%22) are well-scoped and don't require deep protocol knowledge
- Issues labelled [`bounty`](https://github.com/Vatix-Protocol/Swyft/issues?q=label%3Abounty) have a financial reward attached
- Comment on an issue before starting work to avoid duplication
- Stellar Wave issues follow the [labeling policy](docs/STELLAR_WAVE_LABELING_POLICY.md); confirm the area and risk labels before starting work

---

## Package Boundaries

Before opening a PR, know which part of the monorepo your change belongs in. Reviewers will ask you to move code that lands in the wrong place.

| Location | Owns | Examples of what belongs here |
|---|---|---|
| `apps/web` | The Next.js dApp — UI, pages, client-side hooks, wallet connection | A new swap form component, a page route, `useWalletBalances` |
| `apps/api` | The NestJS backend — REST/WebSocket endpoints, the Horizon indexer, database access | A new `/pools/:id/ticks` endpoint, a BullMQ worker, a Prisma query |
| `packages/contract` | Soroban smart contracts (Rust) | Pool math, tick logic, admin functions |
| `packages/sdk` | `@swyft/sdk` — the TypeScript client that wraps contract calls and API requests | A typed helper for building a swap transaction, RPC client code shared by web and other consumers |
| `packages/ui` | `@swyft/ui` — shared, presentation-only React components | A `Button` or `Modal` used by more than one app |
| `packages/config` | Shared tooling config | ESLint, TypeScript, Tailwind base configs |

Rules of thumb:

- **If it renders something**, it goes in `apps/web` unless it's a generic, reusable component with no app-specific logic — then it belongs in `packages/ui`.
- **If it talks to Postgres, Redis, or Horizon**, it belongs in `apps/api`, not the SDK or frontend.
- **If both `apps/web` and an external consumer would need it** (e.g. transaction-building helpers, typed API responses), put it in `packages/sdk` rather than duplicating it.
- Cross-cutting changes (e.g. a new field that touches a contract, the indexer, the SDK, and the UI) are fine — just split them across the relevant packages rather than reaching into another package's internals directly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how these pieces fit together end to end (Horizon → indexer → API → SDK → frontend).

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
   These scripts are Turborepo tasks — each one runs `turbo run <task>` across the
   workspace, so a single command covers every app and package. To scope a task to
   one package, use a pnpm filter, e.g. `pnpm --filter api test` or
   `pnpm --filter web lint`.
4. Push your branch and open a PR against `main`.
5. Fill in the PR template — summary, testing steps, linked issue.
6. One maintainer approval is required to merge.
7. PRs are **squash-merged** — keep your commit history clean but it isn't strictly required.

---

## Code Standards

- **TypeScript**: Strict mode enabled. Every workspace `tsconfig.json` extends [`packages/config/tsconfig.base.json`](packages/config/tsconfig.base.json) and may not turn strict flags off (`pnpm config:check`). No `any` without a comment explaining why.
- **Rust**: `cargo clippy` must pass with no warnings. Follow standard Rust idioms.
- **Formatting**: Run `pnpm format` before committing. Prettier config is at `.prettierrc`.
- **Linting**: Run `pnpm lint` before committing. Each app keeps its framework preset in its own `eslint.config.mjs` and spreads the shared layer from [`packages/config/eslint.js`](packages/config/eslint.js) last. `pnpm config:check` fails CI if an app skips it or weakens a shared security rule. See [`packages/config/README.md`](packages/config/README.md).
- **Accessibility**: Frontend components must meet WCAG 2.1 AA. Use semantic HTML and ARIA attributes where needed.

---

## Testing

| Layer | How to run | Expectation |
|---|---|---|
| Soroban contracts | `cargo test --workspace` in `packages/contract` | All tests pass |
| NestJS API unit | `pnpm --filter api test` | All tests pass |
| NestJS API e2e | `pnpm --filter api test:e2e` | Requires running Postgres + Redis |
| TypeScript SDK | `pnpm --filter @swyft/sdk test` | All tests pass |
| Shared config | `pnpm config:check` and `pnpm --filter @swyft/config test` | Every workspace uses the shared TS/ESLint config |
| Fixtures | `pnpm fixtures:check` and `pnpm test:scripts` | Fixtures are deterministic, registered and in sync. See [`fixtures/README.md`](fixtures/README.md) |

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

Open a [GitHub Discussion](https://github.com/Vatix-Protocol/Swyft/discussions) — the maintainer and community are there to help.
