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

## Router: Multi-Hop Routing Decision (Explicit Non-Goal)

The `router` contract performs **single-hop swaps only**. Multi-hop routing
(routing a single user swap across two or more pools) is an **explicit
non-goal** for the current router interface. This is a deliberate, documented
decision — not an oversight — so that contributors and integrators do not
assume multi-hop support exists or silently degrade into it.

### Decision

- **Single-hop is the supported surface.** `router` routes a swap through
  exactly one pool. The `pool_id` in a swap request identifies that single
  pool; the router never chains pools.
- **Multi-hop is denied by default (fail-closed).** A request that would
  require more than one hop is **rejected**, not silently split, partially
  filled, or best-effort routed. There is no implicit fallback to a
  single-hop subset of a multi-hop intent.
- **No silent degradation.** The router never returns a worse-than-requested
  route without an explicit error. If a caller asks for a route the router
  cannot serve, it fails with a stable error code (below) rather than
  executing a different route.
- **Future-proof interface.** The request/response types are versioned and
  carry an explicit `hops` field so that a future multi-hop implementation can
  be added without a breaking change to the single-hop surface. Today the only
  accepted value is a single hop; any other value is rejected.

### Typed interface

Swap requests carry an explicit hop descriptor. The router validates it
before touching pool state.

| Field        | Type            | Notes                                                        |
| ------------ | --------------- | ------------------------------------------------------------ |
| `pool_id`    | `Address`       | The single pool to route through; immutable for the request  |
| `hops`       | `u32`           | Number of hops. **Must be `1`.** Any other value is rejected  |
| `amount_in`  | `i128`          | Input amount; validated by the pool, not trusted from client |
| `min_out`    | `i128`          | Slippage floor; enforced by the pool (see slippage params)    |
| `correlation_id` | `BytesN<32>` | Opaque id echoed in errors/logs for tracing; never a secret  |

### Stable error codes

| Code | Name                  | Meaning                                                       |
| ---- | --------------------- | ------------------------------------------------------------- |
| 1    | `MultiHopNotSupported`| `hops != 1`; multi-hop routing is an explicit non-goal        |
| 2    | `InvalidHopCount`     | `hops == 0` or otherwise malformed hop descriptor             |
| 3    | `PoolNotFound`        | `pool_id` is not a registered pool                            |
| 4    | `Unauthorized`        | Caller is not authorized for the requested route              |
| 5    | `SlippageExceeded`    | Realized output is below `min_out`                            |

### Authorization (deny-by-default)

- The router is **deny-by-default**: only explicitly authorized callers may
  invoke a swap. Untrusted clients cannot bypass the multi-hop policy by
  supplying a crafted `hops` value or by chaining router calls — each call is
  independently validated and authorized.
- Authorization is enforced **before** any pool state is read or mutated, so a
  rejected multi-hop request cannot move funds or alter pool state.
- The contract remains the **source of truth** for balances, swaps, and admin;
  client-supplied `amount_in`/`min_out` are validated, never trusted.

### Idempotency & replay

- Swap requests carry a `correlation_id`; replayed requests with the same id
  are rejected rather than double-executed. Multi-hop rejections are
  idempotent: repeating a rejected request yields the same stable error code.

### Observability

- Rejections emit the stable error code, the offending `hops` value, and the
  `correlation_id` so ops can trace failures in logs.
- Output **never** includes secrets, private keys, or full environment dumps;
  only public identifiers and error codes are shown.

### Rollout / rollback

- The single-hop-only policy is the current behavior; the versioned `hops`
  field is additive and read-only with respect to chain state.
- A future multi-hop implementation would land behind a feature flag and
  require a readiness checklist before any mainnet-affecting change.
- Rollback: revert the router interface change; no on-chain state migration is
  required for the non-goal enforcement itself.

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
| `fee_tier`     | `u32`     | contract        | Fee tier in hundredths of a basis point; immutable after mint|
| `tick_lower`   | `i32`     | contract        | Lower tick bound; immutable after mint                       |
| `tick_upper`   | `i32`     | contract        | Upper tick bound; immutable after mint                       |
| `liquidity`    | `i128`    | contract        | Position liquidity; updated only by pool operations          |
| `owner`        | `Address` | contract        | Current owner; changes only via authorized transfer          |
