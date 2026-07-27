# Fee collector authorization model

## Roles

| Role | Who | Powers |
| ---- | --- | ------ |
| **Admin** | Address set at `initialize` | Toggle fee switch, authorize/revoke pools, withdraw (`collect_protocol_fees`) |
| **Authorized pool** | Pool contract registered via `set_authorized_pool` | Deposit protocol fees (`deposit_protocol_fees`) |

## Inbound collect path (pool → fee collector)

Pools push protocol fees with `deposit_protocol_fees(token, from, amount)`:

1. `amount` must be positive.
2. `from` **must** be in the authorized-pool registry — otherwise the call
   panics with `unauthorized pool caller`.
3. If the fee switch is off, the call is a no-op (balance unchanged).
4. If the fee switch is on, `from` must authorize the transfer and tokens move
   into the fee-collector contract.

Unauthorized contracts, EOAs, or end-of-day bots that are not registered pools
cannot deposit.

## Outbound collect path (fee collector → treasury)

Only the **admin** may call `collect_protocol_fees(token, to)` to withdraw
accumulated balances.

## Registry API

```text
set_authorized_pool(pool, authorized)  // admin-only
is_authorized_pool(pool) -> bool
```

Implementation: `packages/contracts/fee-collector`.
