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

## pool-factory: Fee Tier Allowlist

The `pool-factory` contract deploys pools and maintains the registry of
**allowed fee tiers**. Fee tiers are an explicit **allowlist**: a pool can only
be created for a fee tier that has been enabled by an authorized admin. This is
a money-path surface, so it is **deny-by-default** and **fail-closed**.

### Entrypoints

| Entrypoint            | Direction | Semantics                                                       |
| --------------------- | --------- | --------------------------------------------------------------- |
| `enable_fee_tier`     | write     | Privileged: add a fee tier to the allowlist                     |
| `disable_fee_tier`    | write     | Privileged: remove a fee tier from the allowlist                |
| `is_fee_tier_allowed` | read      | Return whether a fee tier is currently allowed                  |
| `create_pool`         | write     | Deploy a pool; reverts unless the fee tier is allowed           |

### Invariants

- **Allowlist is authoritative.** `create_pool` succeeds only when the
  requested fee tier is present in the allowlist. There is no implicit or
  default-allowed tier; an unknown tier is rejected.
- **Deny-by-default.** A fee tier that was never enabled, or that has been
  disabled, is not allowed. Disabling a tier takes effect immediately and
  blocks new pools for that tier.
- **Privileged writes are authorized.** `enable_fee_tier` and
  `disable_fee_tier` require the factory admin role; untrusted callers cannot
  mutate the allowlist. Authorization is checked before any state change.
- **Idempotent admin writes.** Enabling an already-enabled tier (or disabling
  an already-disabled tier) is a no-op that does not corrupt state or emit a
  spurious change event.
- **Existing pools are unaffected.** Disabling a tier does not migrate, pause,
  or alter pools already deployed for that tier; it only gates new deployments.
- **Contract is source of truth.** Callers cannot supply or override the
  allowlist; the factory's stored state is the only authority for fee-tier
  policy.

### Stable error codes

| Code | Name                  | Meaning                                                    |
| ---- | --------------------- | ---------------------------------------------------------- |
| 1    | `FeeTierNotAllowed`   | `create_pool` called with a tier not on the allowlist      |
| 2    | `Unauthorized`        | Caller lacks the factory admin role for a privileged write |
| 3    | `InvalidFeeTier`      | Fee tier is malformed or outside the valid range           |
| 4    | `FeeTierAlreadySet`   | Enable/disable requested a state the tier is already in    |

### Observability

- Allowlist changes and rejected `create_pool` calls emit the stable error
  code, the fee tier, and a per-request **correlation id** so ops can trace a
  money-path decision.
- Logs **never** include secrets, private keys, or full environment dumps;
  only fee tiers, roles, and public identifiers are shown.

### Rollout / rollback

- The allowlist is additive and gated: it can be feature-flagged so the
  allowlist check is enforced only when the flag is on, allowing a safe
  rollout on testnet before mainnet.
- Rollback: disable the flag (or re-enable previously allowed tiers) to
  restore prior behavior; no on-chain state migration is required.

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
  non-decreasing over time; `observe` rejects any observation that would
  decrease it (fail-closed against adversarial input).
- **Deny-by-default config.** `set_pool_config` requires the oracle admin
  role; a pool with no registered config returns a stable error rather than a
  default/zero TWAP.
- **Contract is source of truth.** Callers cannot supply a pre-computed TWAP;
  the adapter derives it from stored observations only.

### Stable error codes

| Code | Name                | Meaning                                                    |
| ---- | ------------------- | ---------------------------------------------------------- |
| 1    | `PoolNotConfigured` | `twap`/`observe` called for a pool with no oracle config   |
| 2    | `Unauthorized`      | Caller lacks the oracle admin role for a privileged write  |
| 3    | `NonMonotonic`      | Observation would decrease the cumulative price            |
| 4    | `InvalidObservation`| Malformed observation (bad timestamp or price)             |

### Observability

- Rejected observations and config changes emit the stable error code, the
  pool id, and a per-request **correlation id** so ops can trace a price-path
  decision.
- Logs **never** include secrets, private keys, or full environment dumps;
  only pool ids, roles, and public identifiers are shown.

### Rollout / rollback

- The adapter is additive and read-only with respect to pool state: it stores
  its own observations and does not mutate pool balances or swaps.
- Rollback: revert the adapter deployment; no pool state migration is required.
