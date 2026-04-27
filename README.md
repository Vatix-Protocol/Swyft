# Swyft

> Concentrated liquidity DEX on Stellar.

Swyft is a decentralized exchange built on Stellar using Soroban smart contracts. Inspired by Uniswap v3, it brings concentrated liquidity to the Stellar ecosystem — enabling capital-efficient trading, lower fees, and MEV protection. There is no v3-style DEX on Stellar yet. Swyft is the first.

---

## Why Swyft?

| | Swyft | Traditional Stellar DEXes |
|---|---|---|
| Liquidity model | Concentrated (v3-style) | Full-range only |
| Capital efficiency | High — LPs set custom price ranges | Low |
| MEV protection | Yes | No |
| Developer SDK | TypeScript (`@swyft/sdk`) | None |
| Open source | MIT | Varies |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Rust / Soroban |
| Backend API | NestJS — REST + WebSocket |
| Database | PostgreSQL + Redis (Prisma, BullMQ) |
| Frontend | Next.js 14, Tailwind CSS, Radix UI |
| SDK | TypeScript (`@swyft/sdk`) |
| Wallets | Freighter / xBull |
| Monorepo | Turborepo + pnpm workspaces |
| CI/CD | GitHub Actions |
| License | MIT |

---

## Repo Structure
```
swyft/
├── apps/
│   ├── web/              # Next.js dApp
│   └── api/              # NestJS backend
├── packages/
│   ├── contracts/        # Soroban Rust contracts
│   ├── sdk/              # @swyft/sdk (TypeScript)
│   ├── ui/               # @swyft/ui shared components
│   └── config/           # Shared ESLint, TS, Tailwind configs
├── docs/                 # Protocol spec, contributor guides
└── .github/              # CI workflows, issue templates
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust + `stellar-cli` ([install guide](https://developers.stellar.org/docs/smart-contracts/getting-started/setup))
- Docker (for local Postgres + Redis)

### Local dev
```bash
# Clone the repo
git clone https://github.com/Vatix-Protocol/Swyft.git
cd swyft

# Install all dependencies
pnpm install

# Copy env files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Start everything
pnpm dev
```

This starts the Next.js dApp, NestJS API, and watches contract changes simultaneously via Turborepo.

### Run contract tests
```bash
cd packages/contracts
stellar-cli contract test
```

### Run API tests
```bash
pnpm --filter api test
```

---

## Architecture
```
Browser (Freighter / xBull wallet)
          │
    Next.js dApp
          │
      @swyft/sdk
       ╱        ╲
NestJS API    Soroban RPC
(REST + WS)       │
   │          Soroban contracts
PostgreSQL         │
  + Redis     Stellar network
```

The NestJS backend indexes Soroban events from Stellar Horizon, caches pool state in Redis, and exposes a REST API and WebSocket gateway for real-time price feeds. The frontend communicates with both the API and Soroban RPC directly via the SDK.

---

## Roadmap

| Phase | Timeline | Focus | Status |
|---|---|---|---|
| Phase 0 — Foundation | M1–2 | Monorepo, CI, contributor onboarding | 🟡 In progress |
| Phase 1 — Core contracts | M2–5 | Soroban CL pool, router, position NFT | ⚪ Planned |
| Phase 2 — Backend & SDK | M4–7 | NestJS API, indexer, `@swyft/sdk` | ⚪ Planned |
| Phase 3 — Frontend | M6–9 | Swap UI, LP management, pool browser | ⚪ Planned |
| Phase 4 — Mainnet | M9–12 | Audit, mainnet deploy, liquidity bootstrap | ⚪ Planned |
| Phase 5 — Growth | M12+ | Governance, fee tiers, integrations | ⚪ Future |

Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

## Contributing

Swyft is built almost entirely by external contributors. The maintainer handles architecture decisions, PR reviews, and releases. Contributors handle features.

**Pick up an issue and open a PR — that's it.**

### Good first issues

Look for issues labelled [`good first issue`](https://github.com/your-org/swyft/issues?q=label%3A%22good+first+issue%22). These are small, well-scoped tasks that don't require deep protocol knowledge.

### Issue labels

| Label | Meaning |
|---|---|
| `good first issue` | No deep protocol knowledge needed |
| `bounty` | Financial reward attached |
| `contracts` | Soroban / Rust work |
| `backend` | NestJS / API work |
| `frontend` | Next.js / React work |
| `sdk` | TypeScript SDK work |
| `docs` | Documentation |

### PR conventions

- Branch from `main`, name your branch `feat/...`, `fix/...`, or `docs/...`
- Follow [conventional commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `chore:`
- All PRs must pass CI (lint + tests + build)
- One maintainer approval required to merge
- Squash merge only

Full guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## Security

Please do not open public GitHub issues for security vulnerabilities. See [`SECURITY.md`](SECURITY.md) for the responsible disclosure process.

---

## License

[MIT](LICENSE) — free to use, fork, and build on commercially.

---

## Community

- **GitHub Issues** — bug reports, feature requests
- **GitHub Discussions** — RFCs, architecture proposals, Q&A
- **GitHub Projects** — live task board

---

*Swyft is in active development. Contracts are unaudited. Do not use on mainnet until a security audit has been completed.*

## 💰 Bounty Contribution

- **Task:** [Feat/backend]:  Implement webhook notifications for pool events
- **Reward:** $10000
- **Source:** GitHub-Paid
- **Date:** 2026-04-27

