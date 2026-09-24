# ADR-001: API Strategy — GraphQL vs tRPC vs REST

**Date:** 2026-07-26  
**Status:** Accepted (2026-08-31) — **REST-only**. The tRPC hybrid proposed
below was never implemented (no `@trpc/*` dependency, no `apps/api/src/trpc/`
in the tree) and is superseded by this decision. `docs/TRPC-IMPLEMENTATION.md`
remains archived for reference only.  
**Context:** Issue #548, #511, #861, #996

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

## Recommendation (superseded): ~~REST + tRPC (Hybrid)~~

The hybrid below was the original proposal. It was never implemented, and is
superseded by the **REST-only** decision recorded above — see the updated
Decision section.

**Original rationale (kept for history):**
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

### Phase 1: Spike (Prototype, this issue) — **will not do**
- [x] ~~Bootstrap tRPC in NestJS context~~ — not needed, REST-only decided
- [x] ~~Create `poolsRouter` with `list()` procedure~~ — not needed, REST-only decided
- [x] ~~Test type inference on web client~~ — not needed, REST-only decided
- [x] ~~Document patterns for future routers~~ — not needed, REST-only decided

### Phase 2: Hardening (separate issue) — **will not do**
- [x] ~~Add auth middleware (JWT verification via context)~~ — N/A, REST-only
- [x] ~~Implement response caching (Redis via `headers()` context)~~ — N/A, REST-only
- [x] ~~Batch optimization (handle N pool IDs in single tRPC call)~~ — N/A, REST-only
- [x] ~~Error boundary (normalize DB/Horizon errors)~~ — N/A, REST-only

### Phase 3: Rollout (separate issue) — **will not do**
- [x] ~~Migrate web component fetch → tRPC client~~ — N/A, REST-only
- [x] ~~Add tRPC hooks (useQuery, useMutation)~~ — N/A, REST-only
- [x] ~~Deprecation window for REST (maintain 6mo minimum)~~ — N/A, REST stays primary/only API

## Decision

**Accepted (2026-08-31): REST-only.** `apps/api` continues to expose REST (+
WebSocket for realtime) as the sole internal and external API surface. No
tRPC or GraphQL layer is added. This closes the open spike in
`docs/GRAPHQL_VS_TRPC_SPIKE.md` and formally supersedes the tentative hybrid
recommendation above, which was never implemented. `docs/TRPC-IMPLEMENTATION.md`
stays archived as a reference blueprint only, and should not be picked back
up without a new ADR reopening this decision.

## API Invariants (REST-only, issue #996)

These invariants are normative for every REST entrypoint in `apps/api` and
must be enforced by code review and tests. They make the REST-only decision
operationally safe for money-path surfaces (pools, swaps, settlement).

1. **Typed entrypoints.** Every controller method has an explicit request DTO
   and response DTO (or a shared `@swyft/types` interface). No `any` on the
   wire. Validation runs via `ValidationPipe` with `whitelist: true` and
   `forbidNonWhitelisted: true` so unknown fields are rejected, not ignored.
2. **Stable error codes.** Errors are returned as
   `{ code, message, correlationId }` where `code` is a stable, documented
   string (e.g. `POOL_NOT_FOUND`, `INSUFFICIENT_LIQUIDITY`, `UNAUTHORIZED`).
   HTTP status is derived from the code; clients must branch on `code`, never
   on `message`.
3. **Correlation ids.** Every request carries or is assigned an
   `x-correlation-id` (UUIDv4 when absent). It is echoed in the response
   header, included in the error body, and attached to every log line and
   metric for that request. Correlation ids must never contain user input
   verbatim.
4. **Deny-by-default authz.** New privileged surfaces (admin, treasury,
   settlement, config) are guarded by default. A route is public only when it
   is explicitly annotated as such and reviewed. Untrusted clients cannot
   bypass policy by omitting headers, spoofing roles, or replaying tokens.
5. **Idempotency on writes.** Money-path writes (swap, add/remove liquidity,
   settlement) require an `Idempotency-Key`. Replays with the same key and
   same body return the original result; same key with a different body is
   rejected with `IDEMPOTENCY_KEY_REUSED`.
6. **Fail-closed on dependency outage.** If the DB, Redis, or Horizon RPC is
   unavailable, write endpoints fail closed with `503 SERVICE_UNAVAILABLE` and
   a stable code. Reads may serve cached data only when explicitly marked
   stale; they must never fabricate balances.
7. **Server is source of truth.** Balances, swap quotes, and admin state are
   computed server-side. Client-supplied amounts, prices, or roles are treated
   as untrusted input and re-validated against on-chain/DB state.
8. **Rate limiting.** Every external entrypoint is rate-limited per identity
   (API key, JWT subject, or IP for anonymous reads). Limits are enforced
   before any DB/RPC work.
9. **Observability without secrets.** Metrics and logs record route, status,
   latency, correlation id, and stable error code. They never log tokens,
   private keys, full request bodies, or PII. Money-path endpoints emit
   counters for success/failure and a latency histogram.
10. **Feature flags / kill switch.** Any change that can move funds or affect
    mainnet is gated behind a feature flag with a documented kill switch and
    rollback path in the PR description.

### Test expectations

- Unit tests assert each invariant, including auth negatives (missing role,
  expired token, wrong tenant) and idempotency replay behavior.
- Integration/e2e tests cover the critical path (quote → swap → settlement)
  against a testnet or mocked Horizon, and assert fail-closed behavior when
  the DB/Redis/RPC dependency is down.
- CI must stay green; new privileged surfaces add a required check rather than
  relying on reviewer memory.

### Mainnet safety

No irreversible mainnet action ships without the readiness checklist. Risky
changes land behind a flag first, with the rollback documented in the PR.

---

## Related Issues
- #511 — Original API strategy discussion
- #548 — This spike (tRPC prototype)
- #996 — ADR-001 API strategy followed (invariants above)
- Future: Hardening phase, mobile considerations
