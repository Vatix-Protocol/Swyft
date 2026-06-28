# Swyft Roadmap

This document outlines the planned development phases for Swyft — a concentrated-liquidity DEX on Stellar.

> Timelines are approximate. Phase boundaries may shift based on audit schedules and contributor availability.

---

## Phase 0 — Foundation (M1–2) 🟡 In progress

**Goal:** Establish the monorepo, CI pipeline, and contributor experience.

- [x] Monorepo with Turborepo + pnpm workspaces
- [x] GitHub Actions CI (lint, test, build)
- [x] Contributor docs (`CONTRIBUTING.md`, `SECURITY.md`)
- [x] Issue and PR templates
- [x] Core Soroban contract scaffolding (math-lib, pool, router, position-nft, fee-collector, oracle-adapter)
- [ ] Full contract test coverage
- [ ] Local dev environment (Docker Compose)

---

## Phase 1 — Core Contracts (M2–5) ⚪ Planned

**Goal:** Production-ready Soroban contracts with comprehensive tests.

- [ ] Concentrated liquidity pool with tick-based accounting
- [ ] Full math-lib coverage (sqrt, liquidity delta, fee growth)
- [ ] Pool factory with registry
- [ ] Multi-hop router
- [ ] Position NFT with on-chain metadata
- [ ] Fee collector with configurable protocol split
- [ ] TWAP oracle adapter
- [ ] 100% unit test coverage
- [ ] Testnet deployment + verification

---

## Phase 2 — Backend & SDK (M4–7) ⚪ Planned

**Goal:** Indexer, REST + WebSocket API, and TypeScript SDK.

- [ ] Stellar Horizon event indexer (pool swaps, LP events)
- [ ] PostgreSQL schema + Prisma migrations
- [ ] Redis caching layer for pool state
- [ ] REST API: pools, ticks, positions, swaps
- [ ] WebSocket gateway: real-time price feeds
- [ ] `@swyft/sdk` — TypeScript client for contracts + API
- [ ] API authentication (wallet-based JWT)
- [ ] Swagger / OpenAPI documentation

---

## Phase 3 — Frontend (M6–9) ⚪ Planned

**Goal:** Fully functional dApp UI.

- [ ] Swap interface (single-hop and multi-hop)
- [ ] LP management (add/remove/rerange liquidity)
- [ ] Pool browser with TVL, APR, volume charts
- [ ] Portfolio dashboard (positions, unclaimed fees)
- [ ] Freighter + xBull wallet integration
- [ ] Mobile-responsive layout
- [ ] Light / dark mode

---

## Phase 4 — Mainnet (M9–12) ⚪ Planned

**Goal:** Secure public launch on Stellar mainnet.

- [ ] Independent security audit of all Soroban contracts
- [ ] Audit findings resolved and re-reviewed
- [ ] Mainnet deployment
- [ ] Liquidity bootstrap program
- [ ] Public API (rate-limited, API key required)
- [ ] Brand site + documentation portal

---

## Phase 5 — Growth (M12+) ⚪ Future

**Goal:** Ecosystem expansion and protocol maturity.

- [ ] Governance module (on-chain voting)
- [ ] Multiple fee tiers (0.05%, 0.3%, 1%)
- [ ] Aggregator integrations (1inch, Paraswap equivalents on Stellar)
- [ ] Cross-chain bridging research
- [ ] Grants program for ecosystem projects building on Swyft

---

## How to Influence the Roadmap

Open a [GitHub Discussion](https://github.com/Valreb001/Swyft/discussions) with the `RFC` label to propose new features or changes to phase priorities. The maintainer reviews RFCs during each monthly planning cycle.
