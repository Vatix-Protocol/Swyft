# ADR-001: API Strategy — GraphQL vs tRPC vs REST

**Date:** 2026-07-26  
**Status:** Proposed — never accepted; `docs/TRPC-IMPLEMENTATION.md` is
archived pending a decision here.  
**Context:** Issue #548, #511

## Problem

Swyft currently uses a REST API (NestJS) for pools, swaps, and other queries. As the API surface grows, we need to evaluate whether REST remains optimal or if GraphQL or tRPC offers better tradeoffs for:
- Type safety and developer experience
- Bandwidth efficiency (over-fetching)
- Maintenance complexity
- Adoption friction for web/mobile clients

## Options

### Option 1: Stay with REST (Status Quo)

**Strengths:**
- Mature, familiar to all developers
- Built into HTTP ecosystem (caching, CDNs, standard tools)
- Zero learning curve for mobile/web clients
- Leverages existing NestJS + Swagger setup
- Query fragmentation is acceptable at scale we're at

**Weaknesses:**
- Clients over-fetch (e.g., `/pools` returns all fields even if only `id` needed)
- No schema coercion — clients must handle serialization
- Hard to version breaking changes without `/v2` duplication
- Each new query shape needs a new endpoint

### Option 2: GraphQL

**Strengths:**
- Precise field selection eliminates over-fetching
- Self-documenting schema (introspection)
- Single endpoint reduces coupling
- Strong type safety for clients via code-gen
- Excellent for mobile (bandwidth-constrained)

**Weaknesses:**
- Operational complexity: query cost analysis, DoS risk (deeply nested queries), N+1 problem
- Caching is harder (single POST endpoint defeats HTTP caching)
- Steeper learning curve for mobile/web teams
- Resolvers can hide expensive operations
- Debugging slower than REST (opaque POST body)
- Maturity burden: Apollo, Hasura, etc. all add weight

### Option 3: tRPC

**Strengths:**
- Full end-to-end type safety (backend ↔ frontend via shared TS types)
- No schema duplication or code-gen — types flow directly
- Simple, lightweight (~10KB bundle)
- Reduces serialization bugs (JSON edge cases vanish)
- Easy to adopt incrementally (one router at a time)
- Query batching built-in
- Can layer caching on top

**Weaknesses:**
- TypeScript-only (mobile/non-TS clients must use REST fallback)
- No standard HTTP caching (requires custom middleware)
- Smaller ecosystem than GraphQL (fewer tools, libraries)
- Requires tRPC client on frontend
- If frontend/backend are separate teams with different languages, breaks type safety promise

## Recommendation: **REST + tRPC (Hybrid)**

**Primary:** Keep REST as public API for mobile/third-party integrations.  
**Secondary:** Add tRPC as internal/web-only layer for type-safe web frontend.

**Rationale:**
1. REST remains stable for backward compatibility and external clients
2. tRPC handles web-specific needs (pools list, price feeds, auth) with zero serialization overhead
3. Type safety on web reduces bugs without disrupting mobile teams
4. Incremental adoption (pools tRPC router first, add swaps/tokens later)
5. No operational complexity (GraphQL's query analyzer, N+1 guards, etc.)
6. Both coexist: web prefers tRPC, API documentation shows REST examples

## Effort Estimate

| Task | Estimate | Notes |
|------|----------|-------|
| tRPC setup + middleware | 2–3h | NestJS integration layer, auth/CORS |
| Pools tRPC router (prototype) | 2–3h | Mirror `PoolsService`, add batching support |
| Web client integration | 2–3h | Replace fetch calls with tRPC client, update hooks |
| E2E tests (tRPC layer) | 2–3h | Verify auth, type safety, error handling |
| **Total** | **8–12h** | Phased rollout over 1–2 sprints |

## Implementation Path

### Phase 1: Spike (Prototype, this issue)
- [ ] Bootstrap tRPC in NestJS context
- [ ] Create `poolsRouter` with `list()` procedure
- [ ] Test type inference on web client
- [ ] Document patterns for future routers

### Phase 2: Hardening (separate issue)
- [ ] Add auth middleware (JWT verification via context)
- [ ] Implement response caching (Redis via `headers()` context)
- [ ] Batch optimization (handle N pool IDs in single tRPC call)
- [ ] Error boundary (normalize DB/Horizon errors)

### Phase 3: Rollout (separate issue)
- [ ] Migrate web component fetch → tRPC client
- [ ] Add tRPC hooks (useQuery, useMutation)
- [ ] Deprecation window for REST (maintain 6mo minimum)

## Decision

**Approved:** Proceed with tRPC prototype for pools list query. REST remains primary public API. If prototype meets acceptance criteria (type safety, zero-overhead serialization, <500 LOC setup), commit to Phase 2.

---

## Related Issues
- #511 — Original API strategy discussion
- #548 — This spike (tRPC prototype)
- Future: Hardening phase, mobile considerations
