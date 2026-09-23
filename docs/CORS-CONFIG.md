# API CORS Configuration

Production-grade CORS for the Swyft API. This document is the source of truth for
how the API decides which browser origins may call it, and how that policy is
configured per environment.

Related: `apps/api/src/cors.ts` (implementation), `SECURITY.md` (reporting and
policy), `README.md` (local setup).

## Invariants

1. **Deny by default.** An origin that is not explicitly listed in the active
   environment's allowlist receives **no** CORS headers. The API never reflects
   an arbitrary `Origin` back to the caller.
2. **No wildcard with credentials.** `Access-Control-Allow-Origin: *` is never
   emitted when `Access-Control-Allow-Credentials: true`. Credentialed requests
   are only allowed for exact, allowlisted origins.
3. **Exact-match origins.** Origins are compared as full scheme + host + port
   (`https://app.swyft.example`). No substring, suffix, or regex matching, so
   lookalike domains (`https://app.swyft.example.evil.com`) are rejected.
4. **Environment isolation.** Testnet and mainnet use separate allowlists. A
   testnet origin is never valid on mainnet and vice versa.
5. **Fail closed.** If configuration is missing or malformed, the API starts
   with an empty allowlist (no cross-origin access) rather than an open one.

## Configuration

CORS is driven by environment variables. Values are comma-separated and are
parsed into a typed, frozen allowlist at startup.

| Variable | Required | Description |
| --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | yes (prod) | Comma-separated exact origins permitted for the current environment. |
| `CORS_ALLOW_CREDENTIALS` | no | `true`/`false`. Defaults to `false`. When `true`, wildcard is forbidden. |
| `CORS_MAX_AGE_SECONDS` | no | Preflight cache lifetime. Defaults to `600`. |

Example (mainnet):

```
CORS_ALLOWED_ORIGINS=https://app.swyft.example,https://admin.swyft.example
CORS_ALLOW_CREDENTIALS=true
CORS_MAX_AGE_SECONDS=600
```

Example (testnet):

```
CORS_ALLOWED_ORIGINS=https://app.testnet.swyft.example
CORS_ALLOW_CREDENTIALS=true
```

### Parsing rules

- Whitespace around entries is trimmed; empty entries are dropped.
- Entries must be absolute origins (`scheme://host[:port]`). Invalid entries are
  discarded and logged (without echoing secrets) rather than widening the policy.
- Duplicate entries are de-duplicated.
- If `CORS_ALLOWED_ORIGINS` is unset or yields zero valid entries, the allowlist
  is empty and all cross-origin requests are denied.

## Behavior

- **Allowed origin:** the response includes `Access-Control-Allow-Origin` set to
  that exact origin, plus `Vary: Origin` so caches do not serve one origin's
  response to another.
- **Disallowed origin:** no CORS headers are added. The request is not rejected
  at the CORS layer (the browser enforces the block); authorization still applies
  to the actual endpoint.
- **Preflight (`OPTIONS`):** allowed methods and headers are returned only for
  allowlisted origins. Disallowed origins get no preflight approval.
- **Credentials:** `Access-Control-Allow-Credentials: true` is emitted only when
  `CORS_ALLOW_CREDENTIALS=true` and the origin is allowlisted.

## Edge cases & failure modes

- **Missing/blank config:** empty allowlist, deny all cross-origin. Fail closed.
- **Malformed entry:** dropped and logged; never treated as a wildcard.
- **`null` origin** (sandboxed iframes, some redirects): treated as untrusted and
  denied unless explicitly listed.
- **Environment drift:** testnet and mainnet allowlists are configured
  independently; do not copy one into the other.
- **Adversarial origins:** exact-match comparison prevents suffix/substring
  bypasses.

## Security considerations

- CORS is **not** an authorization mechanism. Every endpoint still enforces its
  own authz; CORS only governs browser cross-origin reads.
- Never place secrets, tokens, or internal hostnames in the allowlist.
- Deny-by-default applies to any new privileged surface; adding an origin is an
  explicit, reviewed change.
- Logs record rejected origins at debug level only and never include request
  bodies, cookies, or authorization headers.

## Operations

- **Metrics:** count of allowed vs. denied origin checks, labeled by environment
  (no origin values in labels to avoid cardinality blowup).
- **Rollback / kill-switch:** to disable cross-origin access immediately, unset
  `CORS_ALLOWED_ORIGINS` (or set it to an empty value) and restart. This fails
  closed with no code change.
- **Change process:** allowlist changes are config-only and reviewed like any
  other production change; document the reason in the PR.

## Testnet vs mainnet

| Environment | Allowlist source | Notes |
| --- | --- | --- |
| Local | `CORS_ALLOWED_ORIGINS` (e.g. `http://localhost:3000`) | Dev only. |
| Testnet | `CORS_ALLOWED_ORIGINS` (testnet hosts) | Never reuse mainnet origins. |
| Mainnet | `CORS_ALLOWED_ORIGINS` (mainnet hosts) | Reviewed, minimal set. |

## References

- `apps/api/src/cors.ts` — implementation of the allowlist and header logic.
- `SECURITY.md` — vulnerability reporting and security policy.
- `README.md` — local development setup.
