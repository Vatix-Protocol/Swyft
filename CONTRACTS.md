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

## oracle-adapter: TWAP Window Configuration Bounds

The `oracle-adapter` contract maintains a per-pool **TWAP window** used to
price swaps, liquidity, and settlement. The window is a money-path
configuration: an unbounded or malformed window lets a caller manipulate the
average (too short → spot-price griefing; too long → stale pricing). The window
is therefore **bounded**, **deny-by-default**, and **fail-closed**.

### Entrypoints

| Entrypoint             | Direction | Semantics                                                       |
| ---------------------- | --------- | --------------------------------------------------------------- |
| `set_twap_window`      | write     | Privileged: set the TWAP window for a pool (bounded)            |
| `get_twap_window`      | read      | Return the configured TWAP window for a pool                    |
| `twap`                 | read      | Return the TWAP over the configured window                      |

### Configuration bounds

- **Minimum window.** The window must be at least `MIN_TWAP_WINDOW`
  (in seconds). A window below the minimum is rejected: it is too short to
  resist spot-price manipulation.
- **Maximum window.** The window must be at most `MAX_TWAP_WINDOW`
  (in seconds). A window above the maximum is rejected: it would price against
  stale observations.
- **Valid interval.** The window must be an exact multiple of the oracle's
  observation interval (`TWAP_INTERVAL`). A window that is not an integer
  multiple of the interval is rejected, so the TWAP is always computed over a
  whole number of observations.
- **No implicit default.** A pool with no configured window has no TWAP; reads
  fail closed rather than falling back to an unbounded or zero window.

### Invariants

- **Bounds are enforced on every write.** `set_twap_window` validates the
  window against `MIN_TWAP_WINDOW`, `MAX_TWAP_WINDOW`, and `TWAP_INTERVAL`
  before any state change. There is no path that stores an out-of-bounds
  window.
- **Deny-by-default.** A window that was never set, or that is out of bounds,
  is not usable. `twap` fails closed instead of returning a spot price.
- **Privileged writes are authorized.** `set_twap_window` requires the oracle
  admin role; untrusted callers cannot change the window. Authorization is
  checked before validation and before any state change.
- **Idempotent admin writes.** Setting the window to its current value is a
  no-op that does not corrupt state or emit a spurious change event.
- **Contract is source of truth.** Callers cannot supply or override the
  window; the adapter's stored state is the only authority for TWAP pricing.
- **Existing pools are unaffected by bounds changes.** Tightening the bounds
  does not retroactively invalidate a previously valid window; it gates new
  writes only.

### Stable error codes

| Code | Name                    | Meaning                                                       |
| ---- | ----------------------- | ------------------------------------------------------------- |
| 1    | `TwapWindowTooShort`    | Window is below `MIN_TWAP_WINDOW`                             |
| 2    | `TwapWindowTooLong`     | Window is above `MAX_TWAP_WINDOW`                             |
| 3    | `TwapWindowNotAligned`  | Window is not an integer multiple of `TWAP_INTERVAL`          |
| 4    | `TwapWindowUnset`       | `twap` read for a pool with no configured window              |
| 5    | `Unauthorized`          | Caller lacks the oracle admin role for a privileged write    |
| 6    | `TwapWindowAlreadySet`  | `set_twap_window` requested the window's current value        |

### Observability

- Window changes and rejected `set_twap_window` calls emit the stable error
  code, the pool, the requested window, and a per-request **correlation id** so
  ops can trace a money-path decision.
- Logs **never** include secrets, private keys, or full environment dumps;
  only pools, windows, roles, and public identifiers are shown.

### Rollout / rollback

- The bounds are additive and gated: they can be feature-flagged so the
  bounds check is enforced only when the flag is on, allowing a safe rollout on
  testnet before mainnet.
- Rollback: disable the flag (or restore the previous bounds) to restore prior
  behavior; no on-chain state migration is required.

## pool: Initialize Authorization (frontrun-safe admin binding)

The `pool` contract is deployed by `pool-factory` and initialized exactly once.
Initialization binds the pool's **admin** and immutable configuration. Because
initialization is a privileged, one-shot write on a money path, it is
**deny-by-default** and **fail-closed**: an untrusted caller must never be able
to frontrun `initialize` and seize the admin role.

### Entrypoints

| Entrypoint     | Direction | Semantics                              
