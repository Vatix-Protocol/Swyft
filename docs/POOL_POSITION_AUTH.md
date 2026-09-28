# Pool and position-NFT authorization

The concentrated-liquidity pool and its position-NFT contract are a single
authorization boundary. A pool accepts its NFT contract only when that
contract reports the pool as its configured minter. Before collecting fees or
removing liquidity, the pool also checks that the referenced NFT exists, is
owned by the authenticated caller, identifies this pool, and has metadata
matching the pool's position record.

## Invariants

- The pool/NFT minter link is checked during pool initialization; a mismatch
  fails before pool state is initialized.
- NFT initialization requires an explicit admin signature and is one-time, so
  an untrusted caller cannot front-run deployment and choose a different
  minter.
- Current NFT ownership, not stale pool metadata, authorizes pool actions.
  Transferring an NFT transfers authority to collect and remove its position.
- A partial liquidity removal updates the existing NFT's liquidity through
  the minter-only `update_liquidity` entrypoint. It does not mint an
  untracked duplicate token.
- Full removal burns the linked NFT. A pool cannot act on an NFT whose
  ownership, pool, range, or liquidity metadata disagrees with its position.

The NFT contract ABI adds `get_minter` and `update_liquidity`; pools now call
both the link and ownership checks. Deploy compatible pool/NFT contract
versions together and verify the link before enabling liquidity operations.
Do not point an existing live pool at a different NFT contract.
