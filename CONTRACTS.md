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
  non-decreasing over time; `observe` reverts with
  `OracleError::NonMonotonicObservation` if a new cumulative value is below the
  last recorded value for that pool.
- **Bounded window.** `twap` uses the pool's configured window; if fewer than
  two observations exist within the window it reverts with
  `OracleError::InsufficientObservations` rather than returning a stale or
  fabricated price.
- **Server/contract is source of truth.** Prices are derived from the pool's
  own reserves/observations; client-supplied prices are never trusted.
- **Idempotency.** Each `observe`/`set_pool_config` carries a caller-supplied
  `correlation_id`. Replayed or concurrent requests with a previously consumed
  id are rejected with `OracleError::DuplicateRequest` and never mutate oracle
  state twice.
- **Fail-closed on dependency outage.** If the pool/RPC dependency is
  unavailable, writes revert with `OracleError::DependencyUnavailable` rather
  than proceeding on stale data.

### Stable error codes

| Code | Name                       | Meaning                                          |
| ---- | -------------------------- | ------------------------------------------------ |
| 1    | `Unauthorized`             | Caller lacks the required role/authorization     |
| 2    | `UnknownPool`              | `pool_id` is not registered with the oracle      |
| 3    | `InsufficientObservations` | Not enough observations in the window for a TWAP |
| 4    | `NonMonotonicObservation`  | Cumulative price went backwards for the pool     |
| 5    | `DuplicateRequest`         | `correlation_id` already consumed (replay)       |
| 6    | `DependencyUnavailable`    | Pool/RPC dependency outage; write failed closed  |
| 7    | `InvalidWindow`            | Zero/negative or malformed TWAP window           |

### Authorization

- `observe` is permissionless for the caller's own pool but every request is
  authorized against oracle policy; untrusted clients cannot write an
  observation for a pool they do not control.
- `set_pool_config` is **deny-by-default** and requires the admin role;
  unauthorized callers receive `OracleError::Unauthorized`.
- `twap` is a read and is permissionless, but still validates `pool_id` and
  reverts with `OracleError::UnknownPool` for unregistered pools.

### Observability

- Money-path metrics are emitted per observation and query: pool id, window,
  computed TWAP, observation count, and outcome code.
- Logs carry the `correlation_id` for tracing and **never** include secrets,
  private keys, or raw signatures.

### Rollout / kill-switch

- Oracle writes are gated behind a feature flag; disabling it makes `observe`
  and `set_pool_config` revert with `OracleError::DependencyUnavailable`
  (fail-closed). Reads continue to serve the last committed per-pool state.
- Rollback: flip the flag off and redeploy the previous oracle-adapter wasm;
  no pool state migration is required.

## Router: Single-Hop Swap Routing (Exact In / Exact Out)

The `router` contract exposes two single-hop entrypoints. Both are typed, return
stable error codes, and are deny-by-default for privileged surfaces.

### Entrypoints

| Entrypoint        | Direction  | Amount semantics                          |
| ----------------- | ---------- | ----------------------------------------- |
| `swap_exact_in`   | exact in   | `amount_in` fixed; `amount_out_min` bound |
| `swap_exact_out`  | exact out  | `amount_out` fixed; `amount_in_max` bound |

### Invariants

- **Single-hop only.** The router resolves exactly one pool for the
  `(token_in, token_out)` pair; multi-hop paths are rejected with
  `RouterError::UnsupportedPath`.
- **Server/contract is source of truth.** Balances, reserves, and swap results
  are read from the pool contract; the router never trusts client-supplied
  amounts beyond the caller's slippage bound.
- **Slippage is fail-closed.** `swap_exact_in` reverts with
  `RouterError::SlippageExceeded` when the realized output is below
  `amount_out_min`; `swap_exact_out` reverts with the same code when the
  required input exceeds `amount_in_max`.
- **Idempotency.** Each swap carries a caller-supplied `correlation_id`.
  Replayed or concurrent requests with a previously consumed id are rejected
  with `RouterError::DuplicateRequest` and never mutate pool state twice.
- **Fail-closed on dependency outage.** If the pool/RPC dependency is
  unavailable, writes revert with `RouterError::DependencyUnavailable` rather
  than proceeding on stale data.

### Stable error codes

| Code | Name                     | Meaning                                        |
| ---- | ------------------------ | ---------------------------------------------- |
| 1    | `Unauthorized`           | Caller lacks the required role/authorization   |
| 2    | `UnsupportedPath`        | Not a single-hop `(token_in, token_out)` pair  |
| 3    | `SlippageExceeded`       | Realized amount violates the caller's bound    |
| 4    | `DuplicateRequest`       | `correlation_id` already consumed (replay)     |
| 5    | `DependencyUnavailable`  | Pool/RPC dependency outage; write failed closed|
| 6    | `InvalidAmount`          | Zero/negative or malformed amount              |

### Authorization

- Swap entrypoints are permissionless for the caller's own funds but every
  request is authorized against routing policy; untrusted clients cannot
  bypass the single-hop resolution or slippage checks.
- Privileged surfaces (pool registration, fee/admin config) are
  **deny-by-default** and require the admin role; unauthorized callers receive
  `RouterError::Unauthorized`.

### Observability

- Money-path metrics are emitted per swap: direction (exact in/out), pool id,
  token 

/* … truncated 4521 chars — edit only what you need near the top … */
