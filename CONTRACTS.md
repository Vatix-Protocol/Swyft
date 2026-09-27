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

## Contract AUTH matrix (pool / router / factory)

Every privileged surface on `pool`, `router`, and `pool-factory` is
**deny-by-default**: a caller with no recognized role is rejected before any
state is read or written. The matrix below is the single source of truth for
which role may invoke which action. It is cross-linked from
[`SECURITY.md`](SECURITY.md) (authorization policy) and enforced at the
contract/API boundary.

### Roles

| Role        | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `Public`    | Any untrusted client; no privileges.                               |
| `Liquidity` | LP that owns a position in a specific pool.                        |
| `Trader`    | Client performing swaps through the router.                        |
| `Operator`  | Service account for routine, non-admin operations.                 |
| `Admin`     | Governance/admin key; the only role that may change policy.        |

### Matrix (roles × actions)

| Action                          | Contract       | Public | Liquidity | Trader | Operator | Admin |
| ------------------------------- | -------------- | :----: | :-------: | :----: | :------: | :---: |
| `swap`                          | `router`       |   ✅   |    ✅     |   ✅   |    ✅    |  ✅   |
| `quote`                         | `router`       |   ✅   |    ✅     |   ✅   |    ✅    |  ✅   |
| `add_liquidity`                 | `pool`         |   ❌   |    ✅     |   ❌   |    ✅    |  ✅   |
| `remove_liquidity`              | `pool`         |   ❌   |    ✅     |   ❌   |    ✅    |  ✅   |
| `collect_fees`                  | `pool`         |   ❌   |    ✅     |   ❌   |    ✅    |  ✅   |
| `create_pool`                   | `pool-factory` |   ❌   |    ❌     |   ❌   |    ✅    |  ✅   |
| `set_pool_config`               | `pool`         |   ❌   |    ❌     |   ❌   |    ❌    |  ✅   |
| `set_factory_config`            | `pool-factory` |   ❌   |    ❌     |   ❌   |    ❌    |  ✅   |
| `pause` / `unpause`             | all            |   ❌   |    ❌     |   ❌   |    ❌    |  ✅   |
| `transfer_admin`                | all            |   ❌   |    ❌     |   ❌   |    ❌    |  ✅   |

### Invariants

- **Deny-by-default.** Any action not explicitly granted to a role in the
  matrix is rejected. New privileged surfaces start with **no** grants and
  must be added to this matrix before they can be called.
- **Server/contract is source of truth.** Balances, swaps, and admin state are
  authoritative on-chain; clients cannot assert a role or balance.
- **Role is bound to the authenticated caller**, never to a client-supplied
  field. A `Liquidity` grant applies only to the pool the caller holds a
  position in.
- **Admin is the only policy mutator.** `set_pool_config`,
  `set_factory_config`, `pause`/`unpause`, and `transfer_admin` are
  `Admin`-only and cannot be delegated to `Operator`.
- **Fail-closed on dependency outage.** If the RPC/DB/Redis dependency needed
  to resolve a role or nonce is unavailable, writes are rejected rather than
  allowed through.
- **Idempotency.** Replayed or concurrent privileged requests are rejected via
  a per-caller nonce; a replayed request never mutates state twice.

### Stable error codes

| Code | Name               | Meaning                                                    |
| ---- | ------------------ | ---------------------------------------------------------- |
| 1    | `Unauthorized`     | Caller has no role granting the requested action           |
| 2    | `WrongRole`        | Caller is authenticated but lacks the required role        |
| 3    | `AuthExpired`      | Caller's authorization has expired                         |
| 4    | `ReplayedRequest`  | Nonce already used (idempotency violation)                 |
| 5    | `DependencyDown`   | Role/nonce dependency unavailable; write failed closed     |
| 6    | `InvalidInput`     | Malformed/adversarial input rejected before authorization  |

### Observability

- Every authorization decision emits the stable error code, the action, the
  contract, and a per-request **correlation id** so ops can trace a denial
  end-to-end.
- Money-path actions (`swap`, `add_liquidity`, `remove_liquidity`,
  `collect_fees`) emit success/failure counters; denials are counted
  separately from errors.
- Logs **never** include secrets, private keys, signatures, or full
  environment dumps — only role names, action names, and public identifiers.

### Rollout / rollback

- Authorization enforcement is additive and deny-by-default; it does not
  change balances or swap math.
- Any mainnet-affecting change to this matrix lands behind a feature flag /
  kill-switch and is documented in the PR with a rollback plan.
- Rollback: revert the enforcement change; no on-chain state migration is
  required.

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
  decrease it.
