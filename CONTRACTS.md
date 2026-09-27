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

## pool: Initialize Authorization (frontrun-safe admin binding)

The `pool` contract is deployed by `pool-factory` and initialized exactly once.
Initialization binds the pool's **admin** and immutable configuration. Because
initialization is a privileged, one-shot write on a money path, it is
**deny-by-default** and **fail-closed**: an untrusted caller must never be able
to frontrun `initialize` and seize the admin role.

### Entrypoints

| Entrypoint     | Direction | Semantics                                                          |
| -------------- | --------- | ------------------------------------------------------------------ |
| `initialize`   | write     | One-shot: bind admin + config; authorized deployer/factory only    |
| `get_admin`    | read      | Return the bound admin (empty until initialized)                   |
| `is_initialized` | read    | Return whether the pool has been initialized                       |

### Invariants

- **Deployer/factory is the only authorized initializer.** `initialize`
  succeeds only when the caller is the authorized deployer (the
  `pool-factory` that deployed the pool, or the configured deployer address).
  Any other caller is rejected before any state change.
- **Deny-by-default.** A pool that has not been initialized has no admin and
  no usable config; privileged pool operations revert until `initialize`
  succeeds. There is no implicit or default admin.
- **One-shot / no re-init.** `initialize` can succeed at most once. A second
  call (including a replayed or concurrent call) fails closed and cannot
  overwrite the admin or config.
- **Frontrun-safe.** The admin is bound to the authorized deployer, not to
  `msg.sender` of an arbitrary first caller. A frontrunner calling
  `initialize` first is rejected as unauthorized, so the admin cannot be
  stolen.
- **Contract is source of truth.** Callers cannot supply or override the
  admin; the pool's stored state is the only authority for admin identity.
- **Fail-closed on dependency outage.** If the authorization check cannot be
  resolved (e.g. factory/deployer lookup unavailable), `initialize` reverts
  rather than proceeding unauthenticated.

### Stable error codes

| Code | Name                  | Meaning                                                       |
| ---- | --------------------- | ------------------------------------------------------------- |
| 1    | `Unauthorized`        | Caller is not the authorized deployer/factory for `initialize`|
| 2    | `AlreadyInitialized`  | `initialize` called on an already-initialized pool            |
| 3    | `InvalidConfig`       | Supplied pool configuration is malformed or out of range      |
| 4    | `AuthUnavailable`     | Authorization source unavailable; init fails closed           |

### Observability

- Rejected `initialize` calls and successful initialization emit the stable
  error code, the caller, the bound admin, and a per-request **correlation id**
  so ops can trace a money-path authorization decision.
- Logs **never** include secrets, private keys, or full environment dumps;
  only roles, public addresses, and public identifiers are shown.

### Rollout / rollback

- Initialization authorization is gated: it can be feature-flagged so the
  deployer-only check is enforced only when the flag is on, allowing a safe
  rollout on testnet before mainnet.
- Rollback: disable the flag to restore prior behavior; no on-chain state
  migration is required (already-initialized pools keep their bound admin).

## math-lib: Fixed-Point (Q64.96) Invariants

The `math-lib` contract provides fixed-point arithmetic in **Q64.96** format
(64 integer bits, 96 fractional bits). All arithmetic is **checked**: overflow
and underflow revert rather than wrapping, and rounding is deterministic.

### Invariants

- **No silent overflow/underflow.** Every add/sub/mul/div uses checked
  arithmetic. A result outside the representable Q64.96 range reverts with
  `MathError::Overflow` (positive) or `MathError::Underflow` (negative) in

/* … truncated 4903 chars — edit only what you need near the top … */
