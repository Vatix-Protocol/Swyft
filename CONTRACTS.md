# Swyft Smart Contracts

All 8 Swyft smart contracts compile and build successfully. (The `hello-world` sample/placeholder was removed from the workspace; it is not a shipped Swyft contract.)

## Contracts

| Contract         | Purpose                     | Status |
| ---------------- | --------------------------- | ------ |
| `math-lib`       | Fixed-point math (Q64.96)   | ✅     |
| `pool`           | Concentrated liquidity pool | ✅     |
| `pool-factory`   | Pool deployment & registry  | ✅     |
| `router`         | Single-hop swap routing     | ✅     |
| `position-nft`   | Liquidity position NFTs     | ✅     |
| `fee-collector`  | Fee accumulation            | ✅     |
| `oracle-adapter` | TWAP oracle (per-pool)      | ✅     |
| `cl-pool`        | Concentrated-liquidity pool | ✅     |

## Testnet registry

Deployed testnet contract IDs live in:

- **JSON registry**: [`packages/contract/deployments/testnet.json`](packages/contract/deployments/testnet.json)
- **Key map / docs**: [`packages/contract/deployments/TESTNET.md`](packages/contract/deployments/TESTNET.md)

Wire addresses into the API via the env keys listed in that registry (see `apps/api/.env.example`).

## Contract address drift gate (`validate:contracts`)

The canonical contract registry is the **Contracts** table above plus the
per-network JSON registries under `packages/contract/deployments/`. The
`validate:contracts` check is the single source of truth for detecting
**address drift** between what is configured/deployed and what is documented.

### What it validates

- **Missing entries.** A contract listed in the canonical registry but absent
  from a network's deployment JSON (or env config) fails the gate.
- **Extra entries.** A contract present in a deployment JSON but not in the
  canonical registry fails the gate (renamed/removed contracts must be
  reconciled, not silently left behind).
- **Renamed entries.** A contract whose name changed between the registry and
  a deployment JSON is reported as a rename (missing + extra pair), not as two
  unrelated errors.
- **Address mismatch.** A contract whose configured address differs from the
  canonical/deployed address for that network fails the gate.
- **Testnet vs mainnet.** Each network is validated independently against its
  own registry; a testnet address must never be accepted for a mainnet entry
  (and vice versa). Cross-network address reuse is a hard failure.

### Fail-closed behavior

- The gate **exits non-zero** on any drift, missing/extra/renamed entry, or
  address mismatch. It never warns-and-continues on a money-path mismatch.
- If the canonical registry or a deployment JSON cannot be read/parsed, the
  gate fails closed (non-zero) rather than skipping validation.
- The gate runs in CI on every PR and is a **required check**; a red gate
  blocks merge.

### Stable error codes

| Code | Name                | Meaning                                                    |
| ---- | ------------------- | ---------------------------------------------------------- |
| 1    | `MissingEntry`      | Canonical contract absent from a network registry          |
| 2    | `ExtraEntry`        | Network registry entry not present in the canonical set    |
| 3    | `RenamedEntry`      | Contract name changed between registry and deployment      |
| 4    | `AddressMismatch`   | Configured address differs from canonical/deployed address |
| 5    | `NetworkMismatch`   | Testnet address used for mainnet entry (or vice versa)     |
| 6    | `RegistryUnreadable`| Canonical registry or deployment JSON missing/unparseable  |

### Observability

- Drift failures print the stable error code, the offending contract name,
  the network, and a per-run **correlation id** so CI logs can be traced.
- Output **never** includes secrets, private keys, or full environment dumps;
  only contract names, networks, and public addresses are shown.

### Rollout / rollback

- The gate is additive and read-only: it inspects registries and config, it
  does not deploy or mutate chain state.
- Rollback: revert the CI job/step; no on-chain state migration is required.

## math-lib: Fixed-Point (Q64.96) Invariants

The `math-lib` contract provides fixed-point arithmetic in **Q64.96** format
(64 integer bits, 96 fractional bits). All arithmetic is **checked**: overflow
and underflow revert rather than wrapping, and rounding is deterministic.

### Invariants

- **No silent overflow/underflow.** Every add/sub/mul/div uses checked
  arithmetic. A result outside the representable Q64.96 range reverts with
  `MathError::Overflow` (positive) or `MathError::Underflow` (negative) instead
  of wrapping around.
- **Representable range.** The minimum representable value is `0` and the
  maximum is `2^64 - 1` in integer units (i.e. `(2^64 - 1) << 96` in raw
  fixed-point). Values at or beyond these bounds fail closed.
- **Deterministic rounding.** `mul_div` rounds **down** (toward zero) and
  `div` truncates toward zero; the same inputs always produce the same output
  across runs and platforms. Rounding never silently crosses a boundary into
  overflow.
- **Division by zero.** Any division or `mul_div` with a zero denominator
  reverts with `MathError::DivisionByZero`.
- **Server/contract is source of truth.** Callers cannot supply a pre-rounded
  or pre-scaled result; all scaling is performed inside `math-lib`.

### Stable error codes

| Code | Name             | Meaning                                          |
| ---- | ---------------- | ------------------------------------------------ |
| 1    | `Overflow`       | Result exceeds the maximum representable value   |
| 2    | `Underflow`      | Result is below the minimum representable value  |
| 3    | `DivisionByZero` | Zero denominator in `div`/`mul_div`              |
| 4    | `InvalidInput`   | Malformed/negative input where unsigned expected |

### Property tests

`math-lib` ships property-based tests asserting the invariants above:

- **Boundary values.** `0`, `1` (smallest unit), and `(2^64 - 1) << 96`
  (maximum) round-trip through add/sub/mul/div without loss.
- **Overflow/underflow.** `max + 1` reverts with `MathError::Overflow`;
  `0 - 1` reverts with `MathError::Underflow`; `max * 2` reverts with
  `MathError::Overflow`. Tests **assert on the revert** rather than allowing
  wraparound (fail-closed).
- **Rounding boundaries.** `mul_div` results just below and just above a
  fractional boundary round deterministically down; the property holds for
  randomized inputs.
- **Adversarial inputs.** Zero denominators, maximum operands, and
  randomized large values never produce a wrapped or silently truncated
  result — they either return a correct in-range value or revert.

### Observability

- Arithmetic reverts carry the stable error code above; no secrets, keys, or
  raw signatures are ever logged.

## Position NFT: Metadata Standards

The `position-nft` contract mints one NFT per liquidity position. Position
metadata is **canonical on-chain state**: the contract is the source of truth
for a position's pool, fee tier, tick range, and liquidity. Off-chain clients
(API, indexers, wallets) MUST treat on-chain metadata as authoritative and
MUST NOT derive balances, ranges, or ownership from client-supplied values.

### Metadata schema

Every position NFT exposes the following typed metadata. Field names are
stable and part of the public interface; renaming a field is a breaking change
and must be reconciled through the contract registry (see the drift gate
above).

| Field          | Type      | Source of truth | Notes                                                        |
| -------------- | --------- | --------------- | ------------------------------------------------------------ |
| `position_id`  | `u64`     | contract        | Monotonic, unique per mint; never reused                     |
| `pool_id`      | `Address` | contract        | Pool the position belongs to; immutable after mint           |
| `fee_tier`     | `u32`     | contract        | Basis points; immutable after mint                           |
| `tick_lower`   | `i32`     | contract        | Inclusive lower tick; `tick_lower < tick_upper`              |
| `tick_upper`   | `i32`     | contract        | Exclusive upper tick; aligned to the pool's tick spacing     |
| `liquidity`    | `u128`    | contract        | Q64.96 liquidity; `0` for a closed/empty position            |
| `owner`        | `Address` | contract        | Current owner; changes only via transfer/approval            |
| `uri`          | `String`  | contract        | Optional metadata URI; MUST NOT contain secrets              |

### Invariants

- **Contract is source of truth.** `pool_id`, `fee_tier`, `tick_lower`,
  `tick_upper`, and `liquidity` are set at mint and only mutated by the
  contract's own liquidity entrypoints. Clients cannot supply or override
  them.
- **Range validity.** `tick_lower < tick_upper`, both aligned to the pool's
  tick spacing, and both within the pool's allowed tick bounds. Invalid ranges
  fail closed at mint.
- **Ownership integrity.** `owner` is the only field changed by transfer; a
  transfer updates `owner` atomically and emits an event. Approvals never
  change `owner`.
- **No secret leakage.** `uri` and any emitted metadata MUST NOT embed private
  keys, signatures, or credentials. Metadata is public by definition.
- **Idempotent mint.** A replayed mint request (same client-supplied
  idempotency key) returns the existing `position_id` rather than minting a
  duplicate; the contract never mints two NFTs for one logical position.
- **Fail-closed on dependency outage.** If a mint/transfer requires an
  external read (e.g. pool state) and that dependency is unavailable, the
  write reverts rather than proceeding with stale or defaulted metadata.

### Entrypoints

| Entrypoint        | Direction | Authz            | Semantics                                              |
| ----------------- | --------- | ---------------- | ------------------------------------------------------ |
| `mint`            | write     | owner (caller)   | Mint a position NFT; idempotent on replay              |
| `metadata`        | read      | public           | Return the typed metadata for a `position_id`          |
| `transfer`        | write     | owner/approved   | Transfer ownership; updates `owner` atomically         |
| `set_uri`         | write     | owner            | Update the optional metadata URI                       |

### Authz (deny-by-default)

- `mint`, `transfer`, and `set_uri` are **deny-by-default**: the caller must
  be the current `owner` (or an approved operator for `transfer`). Any other
  caller is rejected with `PositionError::Unauthorized`.
- `metadata` is a public read and never mutates state.
- Untrusted clients cannot bypass policy by supplying metadata fields; the
  contract ignores client-supplied `pool_id`/`fee_tier`/range/liquidity and
  derives them from authoritative state.

### Stable error codes

| Code | Name             | Meaning                                                    |
| ---- | ---------------- | ---------------------------------------------------------- |
| 1    | `Unauthorized`   | Caller is not owner/approved for a privileged entrypoint   |
| 2    | `NotFound`       | No position exists for the given `position_id`             |
| 3    | `InvalidRange`   | `tick_lower >= tick_upper` or ticks not aligned to spacing |
| 4    | `InvalidFeeTier` | Fee tier not supported by the pool                         |
| 5    | `ReplayRejected` | Idempotency key reused with conflicting parameters         |
| 6    | `DependencyDown` | Required external read unavailable; write failed closed    |

### Observability

- Mint/transfer/set_uri emit events carrying `position_id`, `pool_id`, and a
  per-request **correlation id** so off-chain indexers can trace a position
  across API and chain logs.
- Logs/events **never** include secrets, private keys, or raw signatures; only
  public metadata (ids, addresses, ticks, liquidity) is emitted.
- Metrics on the money path: mint count, transfer count, and
  `DependencyDown`/`ReplayRejected` counters are exported for alerting.

### Rollout / rollback

- Metadata schema changes are additive where possible; a breaking field change
  is gated behind a contract upgrade and documented in the PR.
- Rollback: revert the contract upgrade; existing NFTs retain their on-chain
  metadata, so no off-chain migration is required for a revert.

## Oracle Adapter: Per-Pool TWAP Correctness

The `oracle-adapter` contract exposes a per-pool TWAP oracle. Every entrypoint
is typed, returns stable error codes, and is deny-by-default for privileged
surfaces. TWAP state is **isolated per pool**: observations for one pool can
never influence the TWAP of another.

### Entrypoints

| Entrypoint        | Direction | Semantics                                              |
| ----------------- | --------- | ------------------------------------------------------ |
| `observe`         | write     | Append a cumulative price observation for a pool       |
| `twap`            | read      | Return the time-weighted average price for a pool      |
| `set_pool_config` | write     | Privileged: register/update a pool's oracle config     |

### Invariants

- **Per-pool isolation.** Observations are keyed by `pool_id`; the TWAP for a
  pool is computed only from that pool's own observation ring buffer. There is
  no shared/global accumulator, so no cross-pool state leakage is possible.
- **Monotonic cumulative price.** Each pool's cumulative price is
  non-decreasing over time; `observe` rejects out-of-order or regressing
  timestamps with a stable error code.
- **Deny-by-default config.** `set_pool_config` is privileged; only the
  configured admin may register or update a pool's oracle config. Untrusted
  callers are rejected.
- **Fail-closed reads.** If a pool has no observations, `twap` reverts with a
  stable error code rather than returning a defaulted/zero price.

### Stable error codes

| Code | Name             | Meaning                                                    |
| ---- | ---------------- | ---------------------------------------------------------- |
| 1    | `Unauthorized`   | Caller is not the configured admin for a privileged call   |
| 2    | `NoObservations` | `twap` called for a pool with no observations              |
| 3    | `StaleTimestamp` | Observation timestamp is not strictly increasing           |
| 4    | `UnknownPool`    | Pool has no registered oracle config                       |

### Observability

- `observe`/`set_pool_config` emit events carrying `pool_id` and a per-request
  **correlation id**; no secrets, keys, or raw signatures are logged.

### Rollout / rollback

- Oracle config changes are additive and gated behind the admin entrypoint;
  rollback is a config revert with no on-chain state migration.
