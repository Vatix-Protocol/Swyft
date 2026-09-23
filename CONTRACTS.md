# Swyft Smart Contracts

All 9 Swyft smart contracts compile and build successfully.

## Contracts

| Contract | Purpose | Status |
|----------|---------|--------|
| `hello-world` | Example contract | ✅ |
| `math-lib` | Fixed-point math (Q64.96) | ✅ |
| `pool` | Concentrated liquidity pool | ✅ |
| `pool-factory` | Pool deployment & registry | ✅ |
| `router` | Single-hop swap routing | ✅ |
| `position-nft` | Liquidity position NFTs | ✅ |
| `fee-collector` | Fee accumulation | ✅ |
| `oracle-adapter` | TWAP oracle | ✅ |
| `cl-pool` | Additional pool logic | ✅ |

## Validation

Run the contract validation CLI:

```bash
pnpm validate:contracts
```

Output:
```
Building hello-world... ✓
Building math-lib... ✓
Building pool... ✓
...
Passed: 9/9
All Swyft contracts validated!
```

## Build Details

- **Language**: Rust
- **Platform**: Stellar Soroban
- **Target**: `wasm32-unknown-unknown`
- **Build Tool**: Cargo + Stellar CLI
- **Workspace**: `packages/contract/Cargo.toml`

## Concentrated Liquidity Swap Math (Q64.96)

The `pool` contract implements concentrated liquidity swap math using Q64.96
fixed-point numbers, matching the `math-lib` primitives. The following
invariants MUST hold for every swap and are enforced by the contract:

- **Price representation**: `sqrt_price_x96` is a `u128` Q64.96 value, i.e.
  `sqrt_price_x96 = floor(sqrt(price) * 2^96)`. All price math uses this
  representation; no floating point is used anywhere on the money path.
- **Tick bounds**: `MIN_TICK`/`MAX_TICK` map to `MIN_SQRT_RATIO`/`MAX_SQRT_RATIO`.
  A swap MUST fail closed (stable error code) if the resulting price would
  cross these bounds rather than saturating silently.
- **Amount deltas**: `amount0`/`amount1` are computed from the Q64.96 price
delta and liquidity `L` using the standard CL formulas:
  - `amount0 = L * (sqrt_ratio_b - sqrt_ratio_a) / (sqrt_ratio_a * sqrt_ratio_b)`
  - `amount1 = L * (sqrt_ratio_b - sqrt_ratio_a)`
  with intermediate products widened to `u256` (or checked `u128`) to avoid
  overflow; results are truncated toward zero consistently for both directions.
- **Rounding direction**: input amounts round up, output amounts round down, so
  the pool never pays out more than the invariant allows.
- **Fee accounting**: fees are applied to the input amount before the price
  delta is computed; `amount_in_after_fee` is what drives the swap.
- **Conservation**: for a swap with no fee, `L` is unchanged and the product of
  the two reserves is non-decreasing across the step.

### Error codes

Swap math failures return stable `#[contracterror]` codes (see
`packages/contract/pool/src/error.rs`), including:

- `SqrtPriceOutOfBounds` — computed price outside `[MIN_SQRT_RATIO, MAX_SQRT_RATIO]`.
- `TickOutOfBounds` — target tick outside `[MIN_TICK, MAX_TICK]`.
- `InsufficientLiquidity` — no initialized liquidity at the target tick.
- `AmountOverflow` — Q64.96 intermediate overflowed the widened type.
- `ZeroLiquidity` — swap requested against an empty range.

### Authorization

Swap entrypoints are permissionless but MUST NOT allow a caller to bypass
slippage or price-limit policy: `sqrt_price_limit_x96` and `amount_out_min`
are validated against the computed result and the call fails closed on
violation. Liquidity mint/burn entrypoints are authorized against the
position owner; untrusted callers cannot mint or burn on behalf of another
position.

### Observability

Swap and liquidity events emit the pool address, tick range, and Q64.96
price deltas. No secrets, keys, or off-chain credentials are ever emitted in
events or logs.

## Key Fixes Applied

- Fixed missing `cl-pool/Cargo.toml` and workspace configuration
- Resolved cross-contract linking conflicts (cl-pool → position-nft)
- Fixed type compatibility (i16 → i32 for Soroban)
- Implemented proper error handling with `#[contracterror]`
- Replaced unsafe panic macros with error functions
- Fixed arithmetic overflow and panic safety issues
- Corrected Q64.96 concentrated liquidity swap math and documented invariants

## Next Steps

- [ ] Add comprehensive contract tests
- [ ] Integrate with Stellar testnet
- [ ] Security audit preparation
- [ ] Documentation for contract interfaces
