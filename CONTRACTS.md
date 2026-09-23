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
  token pair, realized amounts, and outcome code.
- Logs carry the `correlation_id` for tracing and **never** include secrets,
  private keys, or raw signatures.

### Rollout / kill-switch

- Router swaps are gated behind a feature flag; disabling it makes both
  entrypoints revert with `RouterError::DependencyUnavailable` (fail-closed).
- Rollback: flip the flag off and redeploy the previous router wasm; no pool
  state migration is required.

## Position NFT: LP NFT Mint / Burn / Transfer Rules

The `position-nft` contract mints one NFT per concentrated-liquidity position.
The NFT is the on-chain proof of ownership for the position's liquidity and
accrued fees. All lifecycle entrypoints are typed, return stable error codes,
and are deny-by-default for privileged surfaces.

### Entrypoints

| Entrypoint        | Direction | Semantics                                              |
| ----------------- | --------- | ------------------------------------------------------ |
| `mint`            | write     | Mint a position NFT on liquidity provision             |
| `burn`            | write     | Burn the position NFT on full withdrawal               |
| `transfer`        | write     | Transfer the position NFT to a new owner               |
| `owner_of`        | read      | Return the current owner of a position NFT             |

### Invariants

- **Mint on provision.** `mint` is called exactly once per new position and
  records the pool id, tick range, and liquidity amount. The contract is the
  source of truth for ownership; client-supplied owner ids are ignored unless
  they match the authenticated caller.
- **Burn on full withdrawal.** `burn` is only valid when the position's
  liquidity is fully withdrawn and all accrued fees are collected. Partial
  withdrawals must not burn the NFT; they revert with
  `PositionNftError::PositionNotClosed`.
- **Transfer only by authorized owner.** `transfer` requires the caller to be
  the current owner (or an approved operator). Untrusted clients cannot move a
  position they do not own; unauthorized callers receive
  `PositionNftError::Unauthorized`.
- **One NFT per position.** A position id maps to at most one live NFT; minting
  a duplicate id reverts with `PositionNftError::DuplicateRequest`.
- **Idempotency.** Each mint/burn/transfer carries a caller-supplied
  `correlation_id`. Replayed or concurrent requests with a previously consumed
  id are rejected with `PositionNftError::DuplicateRequest` and never mutate
  ownership twice.
- **Fail-closed on dependency outage.** If the pool/RPC dependency is
  unavailable, writes revert with `PositionNftError::DependencyUnavailable`
  rather than proceeding on stale ownership or liquidity data.

### Stable error codes

| Code | Name                     | Meaning                                          |
| ---- | ------------------------ | ------------------------------------------------ |
| 1    | `Unauthorized`           | Caller is not owner/operator or lacks role       |
| 2    | `PositionNotClosed`      | Burn attempted before full withdrawal            |
| 3    | `DuplicateRequest`       | `correlation_id` already consumed (replay)       |
| 4    | `DependencyUnavailable`  | Pool/RPC dependency outage; write failed closed  |
| 5    | `InvalidAmount`          | Zero/negative or malformed liquidity amount      |
| 6    | `NotFound`               | Position id has no live NFT                      |

### Authorization

- `mint` is permissionless for the caller's own liquidity but every request is
  authorized against position policy; untrusted clients cannot mint a position
  they did not fund.
- `burn` and `transfer` are **deny-by-default**: only the current owner or an
  explicitly approved operator may call them. Unauthorized callers receive
  `PositionNftError::Unauthorized`.
- Privileged surfaces (operator approval, admin config) require the admin role
  and are deny-by-default.

### Observability

- Money-path metrics are emitted per lifecycle event: operation
  (mint/burn/transfer), pool id, position id, and outcome code.
- Logs carry the `correlation_id` for tracing and **never** include secrets,
  private keys, or raw signatures.

### Rollout / kill-switch

- Position lifecycle writes are gated behind a feature flag; disabling it makes
  `mint`/`burn`/`transfer` revert with `PositionNftError::DependencyUnavailable`
  (fail-closed).
- Rollback: flip the flag off and redeploy the previous position-nft wasm; no
  ownership state migration is required.
