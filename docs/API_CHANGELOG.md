# API Changelog

This document tracks breaking changes and significant API updates to the Swyft REST API.

## Versioning Policy

The API follows semantic versioning for breaking changes:

- **MAJOR** — breaking changes to existing endpoints or response schemas
- **MINOR** — new endpoints or non-breaking feature additions
- **PATCH** — bug fixes and non-breaking improvements

Breaking changes **must** be documented here with migration guidance before release.

## Changelog Discipline

Every entry in this changelog is a contract with downstream consumers. To keep the
changelog trustworthy, all entries follow the rules below.

### Required fields per entry

Each entry **must** include all of the following fields. Entries missing any field are
considered incomplete and must not be merged.

| Field | Description |
|-------|-------------|
| `Date` | ISO-8601 date (`YYYY-MM-DD`) the change landed or is scheduled to land |
| `Version` | The API version the change ships in (see versioning policy) |
| `Change type` | One of `breaking`, `feature`, `fix`, `deprecation`, `security` |
| `Affected endpoints` | Exact paths and methods touched (e.g. `POST /swaps/quote`) |
| `Error codes` | Stable error codes added, changed, or removed (e.g. `SWYFT_QUOTE_STALE`) |
| `Authz / scope impact` | Whether auth requirements, roles, or scopes changed; `none` if unchanged |
| `Migration notes` | What consumers must do; `none` if no action required |
| `Rollback / flag` | Feature flag or kill-switch name, or `n/a` if not gated |

### Discipline rules

1. **Semver is authoritative.** Breaking changes bump MAJOR, additive changes bump MINOR,
   and fixes bump PATCH. The changelog version must match the released API version.
2. **Breaking changes require migration notes.** Any `breaking` entry must include a
   before/after example and a deprecation timeline when applicable.
3. **Money-path and mainnet-affecting changes must be flagged.** Any change touching
   liquidity, swaps, settlement, balances, or admin surfaces must name a feature flag or
   kill-switch and document the rollback procedure in the PR description.
4. **Authz and secret-handling changes cross-link `SECURITY.md`.** If an entry changes
   authentication, authorization, scopes, or secret handling, it must reference the
   relevant section of `SECURITY.md`.
5. **Error codes are stable.** Once published, an error code is never reused for a
   different meaning; removals are documented as `deprecation` before deletion.
6. **Entries land before the code.** The changelog entry is added in the same PR as the
   change, before merge — never retroactively.

## How to Report Breaking Changes

When proposing a breaking API change:

1. Open an issue describing the change and rationale
2. Include migration examples for consuming clients
3. Propose a deprecation timeline (if applicable)
4. Add an entry to this changelog **before** merging the PR

## Unreleased

*(No unreleased breaking changes)*

### Dead-letter replay admin authz (#1026)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | MINOR |
| Change type | security, breaking (ops-only surface) |
| Affected endpoints | `POST /indexer/dead-letters/replay` |
| Error codes | added `DLQ_REPLAY_AUTH_MISSING_KEY`, `DLQ_REPLAY_AUTH_INVALID_KEY`, `DLQ_REPLAY_AUTH_EXPIRED`, `DLQ_REPLAY_AUTH_NOT_CONFIGURED`, `DLQ_REPLAY_AUTH_WRONG_ROLE`, `DLQ_REPLAY_AUTH_DISABLED`, `DLQ_REPLAY_AUTH_MAINNET_DISABLED`, `DLQ_REPLAY_AUTH_RATE_LIMITED`, `DLQ_REPLAY_INVALID_IDEMPOTENCY_KEY`, `DLQ_REPLAY_NOT_FOUND`, `DLQ_REPLAY_DEPENDENCY_UNAVAILABLE` |
| Authz / scope impact | Only the `INTERNAL_API_KEY` ring grants replay (previously `FEE_COLLECTOR_AUTH` was accepted when set). Rate-limited. See [docs/INDEXER_DLQ_REPLAY.md](INDEXER_DLQ_REPLAY.md) and [SECURITY.md → Deploy and Ops Security](../SECURITY.md#deploy-and-ops-security) |
| Migration notes | Operators must set `INDEXER_DLQ_REPLAY_ENABLED=true` (and on mainnet `INDEXER_DLQ_REPLAY_MAINNET_ENABLED=true`). Response gains `correlationId` and `deduplicated`. `jobId` must match `[A-Za-z0-9._:-]{1,128}`. A DLQ store outage now returns 503 instead of `total: 0` / 404 |
| Rollback / flag | `INDEXER_DLQ_REPLAY_ENABLED=false` |

### Price WebSocket pool-updates authn policy (#1027)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | MINOR |
| Change type | feature, security |
| Affected endpoints | `WS /price` |
| Error codes | error frames now carry `code` + `correlationId`; added `WS_AUTH_INVALID`, `WS_INVALID_REQUEST`, `WS_SUBSCRIPTION_LIMIT`; uses existing `WS_AUTH_REQUIRED`, `WS_AUTH_EXPIRED`, `WS_FORBIDDEN` |
| Authz / scope impact | Default unchanged (JWT required). Opt-in `WS_POOL_UPDATES_AUTH_MODE=optional` allows anonymous read-only sessions; invalid/expired tokens are never downgraded. See [docs/WEBSOCKET_RECONNECT.md](WEBSOCKET_RECONNECT.md#pool-updates-authn-policy-price) |
| Migration notes | none by default. Clients should branch on `code`, not `message`. Invalid `poolId` values now get a `WS_INVALID_REQUEST` frame instead of silence |
| Rollback / flag | `WS_POOL_UPDATES_AUTH_MODE=required` (default) |

### Compression middleware safe defaults (#1028)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | PATCH |
| Change type | fix, security |
| Affected endpoints | all HTTP responses; `/auth/*` and `/v1/auth/*` are no longer compressed (BREACH) |
| Error codes | none |
| Authz / scope impact | none |
| Migration notes | none. `Accept-Encoding` q-values are now honoured, and compressed responses carry an accurate `Content-Length` |
| Rollback / flag | `COMPRESSION_ENABLED=false`. See [docs/COMPRESSION.md](COMPRESSION.md) |

### Current-wallet decorator trust boundary (#1033)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | PATCH |
| Change type | security, fix |
| Affected endpoints | `GET /positions`, `GET /positions/activity`, `POST /positions/bulk` (all `@CurrentWallet()` users) |
| Error codes | added `AUTH_INVALID_WALLET`, `AUTH_INSUFFICIENT_ROLE`; kept `AUTH_MISSING_WALLET`, `AUTH_INSUFFICIENT_SCOPE`; removed unused decorator-local `AUTH_MISSING_TOKEN`/`AUTH_INVALID_TOKEN`/`AUTH_EXPIRED_TOKEN` constants (never emitted by the decorator; `JwtAuthGuard` codes unchanged) |
| Authz / scope impact | Wallet now comes only from the `JwtAuthGuard`-verified principal and must be a valid Stellar `G...` key. Fixes positions routes rejecting every valid token with `AUTH_MISSING_WALLET` (decorator read `req.wallet`, guard wrote `req.user`). See [SECURITY.md → Deploy and Ops Security](../SECURITY.md#deploy-and-ops-security) |
| Migration notes | none |
| Rollback / flag | n/a (fail-closed fix; revert the PR) |

### Internal admin key rotation (#1030)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | MINOR |
| Change type | security, feature |
| Affected endpoints | `/admin/*` analytics, indexer replay, fee-collector and testnet-redeploy guarded routes, `GET /metrics/db`, `GET /metrics/indexer`, new `GET /metrics/security` |
| Error codes | none added; a previous key past its window returns the existing `FEE_COLLECTOR_AUTH_EXPIRED` / `TESTNET_REDEPLOY_AUTH_EXPIRED` |
| Authz / scope impact | Optional `<RING>_PREVIOUS` + `<RING>_PREVIOUS_EXPIRES_AT` accepted during a bounded window; constant-time comparison on `/metrics`; rate-limit buckets no longer contain the raw key. See [docs/INTERNAL_KEY_ROTATION.md](INTERNAL_KEY_ROTATION.md) |
| Migration notes | none; unset `_PREVIOUS` vars keep today's single-key behaviour. Production boot rejects malformed rotation config |
| Rollback / flag | Remove `<RING>_PREVIOUS*` to close the window; revert the PR to roll back |

### Analytics scheduler cardinality-safe (#1031)

| Field | Value |
|-------|-------|
| Date | 2026-09-27 |
| Version | PATCH |
| Change type | fix |
| Affected endpoints | none (background job); metrics under `GET /metrics/security` |
| Error codes | none |
| Authz / scope impact | none |
| Migration notes | none |
| Rollback / flag | `ANALYTICS_SCHEDULER_ENABLED=false` |

## v1.0.0

**Released:** TBD

### Initial Release

- REST API with endpoints for pools, positions, swaps, tokens, and webhooks
- WebSocket gateway for real-time price feeds
- Authentication via signed nonces (see `/auth/nonce` and `/auth/verify`)
- Webhook support for pool and position events
- Indexer status endpoint

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pools` | GET | List all pools |
| `/pools/:id` | GET | Get pool details |
| `/pools/:id/ticks` | GET | Get liquidity ticks for a pool |
| `/positions` | GET | List positions (paginated) |
| `/swaps` | GET | List swaps (paginated) |
| `/swaps/quote` | POST | Get a swap quote estimate for a pool |
| `/tokens` | GET | List tokens |
| `/balances` | GET | Get on-chain token balances for a wallet address |
| `/search` | GET | Search pools, tokens, or positions |
| `/indexer/status` | GET | Indexer synchronization status |
| `/health` | GET | API health check |
| `/auth/nonce` | POST | Request a sign-to-auth nonce |
| `/auth/verify` | POST | Verify signed message and receive JWT |
| `/webhooks` | GET | List registered webhooks |
| `/webhooks` | POST | Register a new webhook |
| `/webhooks/:id` | DELETE | Unregister a webhook |

---

## Migration Guides

*(Add migration guides here when breaking changes are introduced)*

### Example: v2.0.0 — Pool Pagination

**Breaking change:** `/pools?limit=100` replaces `/pools?pageSize=100`

**Before:**
```json
GET /pools?pageSize=50&page=2
```

**After:**
```json
GET /pools?limit=50&offset=50
```

---

## Notes

- All timestamps are Unix timestamps in **seconds** (not milliseconds)
- All prices are denominated in **token1 per token0**
- All currency amounts are strings to preserve precision
- Rate limiting is enforced at 300 req/min per IP by default (see `RATE_LIMIT_PER_MINUTE` in `docs/RATE_LIMITING.md`)
- Authz and secret-handling changes must cross-link `SECURITY.md` (see Changelog Discipline)
