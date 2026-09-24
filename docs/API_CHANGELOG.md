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
