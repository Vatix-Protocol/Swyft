# API Changelog

This document tracks breaking changes and significant API updates to the Swyft REST API.

## Versioning Policy

The API follows semantic versioning for breaking changes:

- **MAJOR** — breaking changes to existing endpoints or response schemas
- **MINOR** — new endpoints or non-breaking feature additions
- **PATCH** — bug fixes and non-breaking improvements

Breaking changes **must** be documented here with migration guidance before release.

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
| `/tokens` | GET | List tokens |
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
