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

## MEV protection mechanisms

Swyft's money path (`swap`, `add_liquidity`, `remove_liquidity`,
`collect_fees`) is protected against maximal-extractable-value (MEV) attacks
by the mechanisms below. This section is the single source of truth for MEV
protection and is cross-linked from [`README.md`](README.md) and
[`SECURITY.md`](SECURITY.md) for Stellar Wave contributors.

### Mechanisms

| Mechanism                     | Surface            | What it prevents                                              |
| ----------------------------- | ------------------ | ------------------------------------------------------------ |
| Slippage bound (`min_out`)    | `router.swap`      | Sandwiching: a swap reverts if the realized output is below the caller's bound. |
| Deadline (`deadline`)         | `router.swap`      | Stale/replayed swaps held by a searcher past the caller's intent. |
| Per-caller nonce              | all money-path     | Replay and concurrent duplicate submission of the same swap. |
| TWAP price check              | `oracle-adapter`   | Spot-price manipulation used to mis-price a swap or LP action. |
| Commit-reveal ordering        | `router.swap`      | Front-running by hiding swap intent until it is committed.   |
| Private/batched submission    | `router.swap`      | Public-mempool front-running and back-running.               |

### Invariants

- **Fail-closed.** If the oracle/TWAP needed to validate a price is
  unavailable or stale, the money-path write is rejected rather than executed
  at an unverified price.
- **Caller intent is authoritative.** `min_out` and `deadline` are bound to
  the authenticated caller and cannot be relaxed by a relayer or searcher.
- **No client-supplied price.** The contract derives price from the
  `oracle-adapter` TWAP; a client cannot assert a price or bypass the check.
- **Idempotent.** A replayed or concurrent swap is rejected via the per-caller
  nonce and never mutates state twice.
- **Deny-by-default.** MEV-protection parameters are validated before any
  state is read or written; missing/invalid parameters reject the call.

### Stable error codes

| Code | Name               | Meaning                                                    |
| ---- | ------------------ | ---------------------------------------------------------- |
| 7    | `SlippageExceeded` | Realized output below the caller's `min_out` bound         |
| 8    | `DeadlineExpired`  | Swap submitted after the caller's `deadline`               |
| 9    | `StaleOracle`      | TWAP price unavailable or older than the freshness window  |
| 10   | `PriceManipulated` | TWAP deviates beyond the configured manipulation bound     |

Codes 1–6 (authorization/idempotency) are defined in the AUTH matrix above and
apply to MEV-protected entrypoints as well.

### Observability

- Every MEV-protection decision emits the stable error code, the action, the
  contract, and a per-request **correlation id** so ops can trace a rejection
  end-to-end.
- Money-path actions emit success/failure counters; slippage, deadline, and
  oracle rejections are counted separately from authorization denials.
- Logs **never** include secrets, private keys, signatures, or full
  environment dumps — only action names, error codes, and public identifiers.

### Rollout / rollback

- MEV-protection checks are additive and fail-closed; they do not change swap
  math or balances.
- Any mainnet-affecting change to these mechanisms lands behind a feature flag
  / kill-switch and is documented in the PR with a rollback plan.
- Rollback: revert the enforcement change; no on-chain state migration is
  required.

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
| 2    | `ExtraEntry`        | Deployment entry absent from the canonical registry        |
| 3    | `RenamedEntry`      | Contract renamed between registry and deployment           |
| 4    | `AddressMismatch`   | Configured address differs from canonical/deployed address |
| 5    | `CrossNetworkReuse` | Address reused across testnet and mainnet                  |
| 6    | `RegistryUnreadable`| Registry/deployment JSON missing or unparseable (fail-closed) |

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

### Metadata schema

Every position NFT exposes the following typed metadata. Field names are
stable and part of the public interface; renaming a field is a breaking change
and must be reconciled through the contract registry (see the drift gate
above).

| Field          | Type      | Source of truth | Notes                                                        |
| -------------- | --------- | --------------- | ------------------------------------------------------------ |
| `pos

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

### Metadata schema

