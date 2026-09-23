# SPIKE: GraphQL vs tRPC vs REST for Swyft

## Goal
Decide whether Swyft should move off REST for the `apps/api` <-> `apps/web` boundary, and if so, to GraphQL or tRPC.

## Context
Swyft currently uses REST between `apps/api` and `apps/web`, with types shared manually / via `CONTRACTS.md`. This spike captures the tradeoffs so we can make a deliberate call instead of drifting.

## Options

### Stay on REST
- Pros: no migration cost, well understood, easy to version (see API changelog doc), works well with external consumers/webhooks.
- Cons: manual type sync between client/server, more boilerplate for CRUD-heavy endpoints, no built-in query batching.

### tRPC
- Pros: end-to-end TypeScript types with zero codegen, fast DX since `apps/api` and `apps/web` are both TS in this monorepo, minimal runtime overhead.
- Cons: tightly couples client/server TS types (harder for non-TS or external consumers), less ideal if we plan to expose a public API, ecosystem smaller than GraphQL/REST.

### GraphQL
- Pros: flexible querying for clients, strong tooling (codegen, introspection), good fit if multiple heterogeneous clients (web, mobile, third parties) need different data shapes.
- Cons: higher setup/maintenance cost (schema, resolvers, N+1 handling), overkill if Swyft only has one first-party web client, steeper learning curve for contributors.

## Decision: REST-only (2026-08-31)

Formalized in `docs/ADR-001-API-STRATEGY.md` (Accepted). Swyft stays on REST
(+ WebSocket for realtime) for the `apps/api` <-> `apps/web` boundary and for
external/third-party consumers. Neither tRPC nor GraphQL is adopted. See
`docs/TRPC-IMPLEMENTATION.md` for the archived tRPC blueprint, kept for
reference only.

## Next steps (closed)
- [x] Confirm whether any external/third-party consumers exist today that would be broken by moving internal calls off REST. — Yes: `@swyft/sdk` and any external integrator hit the REST surface directly; REST stays to avoid breaking them.
- [x] Prototype one tRPC router alongside existing REST routes to measure DX/migration cost. — Skipped: REST-only was chosen without a prototype: single first-party web client plus existing external REST consumers don't justify the added operational surface of a second API layer.
- [x] Revisit this doc once a decision is made and link the follow-up PR here. — Decision recorded in ADR-001; this spike is now closed.
