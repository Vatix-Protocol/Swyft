# fixtures/

Canonical, deterministic test data shared across the monorepo. Tracking issue: #1037.

| File                   | Validator         | Consumers                                                                                               |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `cl-math-vectors.json` | `cl-math-vectors` | `packages/sdk` (`contract-math-fixtures.spec.ts`), `cl-pool` (`mod fixture_tests`), + 2 mirrored copies |
| `e2e-seed.json`        | `e2e-seed`        | `prisma/seed.ts` (local/dev DB seed), `apps/api/test/fixtures.ts` (e2e specs)                           |
| `manifest.json`        | —                 | Registry read by `scripts/fixtures.js`; lists each fixture's sha256, mirrors and consumers              |

## Invariants

`pnpm fixtures:check` (CI job **Shared config + fixtures**) enforces all of these and fails closed:

1. **Registered or rejected.** Every `*.json` here must be listed in `manifest.json` with a known
   validator. Unregistered files fail with `FIXTURE_UNREGISTERED`.
2. **Byte-stable.** Files are exactly `JSON.stringify(value, null, 2) + "\n"`. Prettier ignores this
   directory (`.prettierignore`) so `pnpm format` can't reformat it.
3. **Intentional edits only.** The manifest sha256 must match the file. Editing a fixture without
   running `pnpm fixtures:write` fails with `FIXTURE_HASH_MISMATCH`, which makes every fixture change
   show up in review.
4. **Mirrors are copies.** Package-local copies (for package-only test runs) must be byte-identical
   (`FIXTURE_MIRROR_DRIFT`).
5. **No wall clock.** Every timestamp is a pinned UTC ISO string (`2026-01-01T00:00:00.000Z`). DB
   `now()` defaults are never relied on (`FIXTURE_NONDETERMINISTIC_TIME`). E2E specs use
   `e2eNow()` for a fixed clock.
6. **Money is integer strings.** Amounts, liquidity, sqrt prices and TVL are base-10 integer strings,
   never JS numbers, so there is no precision loss above 2^53 (`FIXTURE_SCHEMA_VIOLATION`).
7. **Testnet only.** `e2e-seed.json` must declare `"network": "testnet"`
   (`FIXTURE_NETWORK_NOT_TESTNET`). `prisma/seed.ts` also refuses to run when
   `NODE_ENV=production` or `STELLAR_NETWORK` is `mainnet`/`public` (`SEED_REFUSED`).
8. **Valid, non-secret addresses.** Stellar accounts must be checksum-valid `G…` StrKeys
   (`FIXTURE_INVALID_ADDRESS`). Anything shaped like a secret seed (`S…`) fails with
   `FIXTURE_SECRET_DETECTED`, and `--write` refuses to run while one is present.
9. **Idempotent keys.** Pool ids, swap `eventId`s, token addresses, position `(poolId, tokenId)`
   and candle `(poolId, interval, periodStart)` are unique (`FIXTURE_DUPLICATE_KEY`). These are the
   upsert/`skipDuplicates` keys, so re-seeding is a no-op. References must resolve
   (`FIXTURE_DANGLING_REF`).
10. **Consumers agree.** The tick vectors hard-coded in `cl-pool`'s `mod fixture_tests` must equal
    `tick_to_sqrt_price` (`FIXTURE_CONSUMER_DRIFT`).

## Changing a fixture

```bash
# 1. Edit the canonical file under fixtures/ (never a mirror)
# 2. Re-canonicalise, sync mirrors, refresh hashes (local only; refuses when CI is set)
pnpm fixtures:write
# 3. Verify, then run the consumers
pnpm fixtures:check
pnpm --filter @swyft/sdk test                                   # cl-math-vectors
pnpm --filter api exec jest --config ./test/jest-e2e.json test/fixtures.e2e-spec.ts  # e2e-seed
# 4. If tick vectors changed, update cl-pool `mod fixture_tests` and run cargo test -p cl-pool
```

To add a fixture, add the file, add a manifest entry with a validator from `scripts/fixtures.js`
(`VALIDATORS`), then run `pnpm fixtures:write`. A new kind of data needs a new validator. Never
register an existing validator against a file it wasn't written for.

## Using the e2e seed in specs

```ts
import { loadE2eSeed, toPrismaRows, e2eNow } from './fixtures'; // apps/api/test/fixtures.ts

const rows = toPrismaRows(); // Prisma-shaped rows with Date objects
prismaMock.pool.findMany.mockResolvedValue(rows.pools);
jest.useFakeTimers({ now: e2eNow() }); // optional: pin the wall clock too
```

`loadE2eSeed()` validates the file and returns a deep-frozen object. A spec that mutates it throws
instead of leaking state into the next spec.

## Operations

- Both commands print one JSON summary line (`event`, `correlationId`, `status`, `errorsByCode`) for
  log search. In CI, `correlationId` is `<run_id>-<attempt>-fixtures`. Override it with
  `FIXTURE_CORRELATION_ID`, which is sanitised to `[A-Za-z0-9._-]{1,64}`.
- Exit codes: `0` ok, `1` fixture errors, `2` bad CLI usage.
- **Rollback:** this is test tooling only. It doesn't touch money paths or mainnet, so there is
  no runtime flag. To back it out, revert the PR. The pre-existing hard-coded seed values are the
  same as `e2e-seed.json`.

See also: [SECURITY.md](../SECURITY.md) (no secrets in repo), [CONTRIBUTING.md](../CONTRIBUTING.md#testing),
[packages/sdk/README.md](../packages/sdk/README.md#math-fixtures-contract-parity).
