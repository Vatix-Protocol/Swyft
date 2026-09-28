# Router factory and callback authorization

The router has no caller-supplied callback address or callback entrypoint.
For swaps, it resolves a pool through its configured factory, validates the
pool's token pair, then invokes the pool's `swap` method. The authenticated
`recipient` is the swap funder/receiver; it is not used as a contract-call
target.

## Invariants

- The router is initialized once with an explicit admin and factory.
- The admin must authorize initialization; later calls cannot replace the
  factory or admin.
- Every pool target is returned by that configured factory. The router never
  invokes an arbitrary callback target supplied in swap parameters.
- The recipient must authorize each swap, and the router validates the pool's
  token pair before invoking `swap`.

`initialize` now takes `(admin, factory)`. Deployments must supply the
authorized admin and use the factory selected by governance. Existing router
instances cannot be reconfigured by this code change; deploy and initialize a
new router, then update integrations to use its address. Do not migrate
mainnet integrations until the new router and factory are verified.
