# HTTP Compression

Source of truth for the API response-compression middleware
(`apps/api/src/compression.middleware.ts`, tests in
`apps/api/src/compression.middleware.spec.ts`). Tracking issue: #1028.

Compression is a transport concern. It never touches balances, swaps or admin
state, and it needs no authz: it only changes how a response the handler already
authorised is encoded.

## Safe defaults

| Setting | Default | Valid range | On invalid value |
| --- | --- | --- | --- |
| `COMPRESSION_ENABLED` | `true` | `false` disables | — |
| `COMPRESSION_LEVEL` | `6` | integer 1–9 | default |
| `COMPRESSION_MIN_BYTES` | `1024` | 0 – 5 MiB | default |
| `COMPRESSION_MAX_BUFFER_BYTES` | `5242880` (5 MiB) | 1 KiB – 64 MiB | default |
| `COMPRESSION_EXCLUDED_PATHS` | — | comma-separated `/prefix` list | entry ignored |

Invalid config never crashes the process or a response. Before #1028 a bad
`COMPRESSION_LEVEL` was passed straight to zlib, which threw on the first large
response.

## Invariants

1. **Never breaks a response.** If zlib fails, the original body is sent with
   identity encoding. `Content-Encoding` is only set once compression succeeds.
2. **Bounded memory.** Once a body passes `COMPRESSION_MAX_BUFFER_BYTES`, the
   middleware stops buffering and streams it through uncompressed.
3. **Correct negotiation.** `Accept-Encoding` q-values are honoured (`br;q=0`
   means no brotli). Brotli wins ties. Header parsing is bounded (1 KiB, 32
   entries) to resist adversarial headers.
4. **BREACH.** `/auth` and `/v1/auth` (which return JWTs), plus `/health`, are
   always excluded. `COMPRESSION_EXCLUDED_PATHS` can add prefixes but can
   never remove these. Handlers can opt out per response with
   `Cache-Control: no-transform`.
5. **Pass-through cases:** WebSocket upgrades, `HEAD`, 1xx/204/304 and empty
   bodies, `text/event-stream`, non-text types, already-encoded responses, and
   bodies under `COMPRESSION_MIN_BYTES`.
6. **Caches.** Compressed responses set `Vary: Accept-Encoding` and an accurate
   `Content-Length`.

## Observability

In-process counter `http_compression_outcomes`, with fixed labels only
(`compressed_br`, `compressed_gzip`, `skipped_*`, `error_fallback`). Nothing
request-derived becomes a label. A rising `error_fallback` count means zlib is
failing: clients still get correct responses, but bandwidth goes up. The
fallback warning log carries the zlib error message and never the body.

## Rollback

Set `COMPRESSION_ENABLED=false` and restart. The middleware becomes a no-op,
so no redeploy is needed. It holds no persistent state.

## Related

- [`SECURITY.md`](../SECURITY.md) — security model.
- [`docs/OPS_DEPLOYMENT.md`](OPS_DEPLOYMENT.md) — deploy/rollback procedures.
