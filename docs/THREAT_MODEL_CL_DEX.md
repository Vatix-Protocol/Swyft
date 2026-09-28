# Concentrated-liquidity DEX threat model

This threat model covers Swyft's web client, API/indexer, Soroban contracts,
wallets, and RPC providers. It is a design and review aid, not a substitute
for an independent contract audit. Security vulnerabilities must use the
private process in [`SECURITY.md`](../SECURITY.md).

## Assets and invariants

| Asset | Required invariant |
| --- | --- |
| User funds and position NFTs | Only the position owner and contract-defined roles can move them |
| Pool reserves and liquidity | Every swap, mint, burn, and fee collection is checked on-chain |
| Prices and swap bounds | Client quotes are advisory; the transaction carries a user-selected slippage bound |
| Credentials and signing keys | Never enter Swyft servers, logs, telemetry, or source control |
| Network and contract identity | Testnet and mainnet passphrases and addresses cannot be mixed |
| Availability and market state | Dependency failures fail closed on writes and do not fabricate success |

## System and trust boundaries

1. **Untrusted browser:** The web app can be modified by its user and receives
   untrusted API/RPC responses. It builds transactions but cannot authorize
   them or make on-chain state authoritative.
2. **Wallet boundary:** Freighter/xBull display and sign the XDR. The wallet
   owns the private key; Swyft must never request or persist it. Rejected or
   cancelled signatures must not be submitted.
3. **API boundary:** The API authenticates requests, validates XDR and network
   configuration, applies rate limits/idempotency, and submits transactions.
   It must treat all client fields as attacker-controlled.
4. **RPC/Horizon boundary:** Providers can be unavailable, stale, censored, or
   adversarial. Provider results are inputs to validation, never authorization.
5. **Contract boundary:** Soroban contracts are the source of truth for
   authorization, balances, reserves, fees, deadlines, and slippage.

## Threat register and controls

| Threat | Impact | Required controls and verification |
| --- | --- | --- |
| Forged owner, role, or balance in a request | Unauthorized transfer or admin action | Derive/authenticate the wallet server-side and enforce roles on-chain; negative auth tests |
| Quote manipulation, stale ticks, or sandwiching | User receives an unexpected price | User-supplied min/max amounts, deadline, MEV route where enabled, and contract slippage checks |
| Replay or concurrent submission | Duplicate settlement or confusing status | Idempotency keys at write APIs, transaction hash de-duplication, and contract authorization |
| Wrong network or contract address | Funds sent to an unintended deployment | Fail-closed passphrase/address checks, environment-scoped manifests, and address-drift CI |
| Malicious token/pool/tick input | DoS, invalid math, or unexpected contract call | Branded/validated SDK inputs, bounded tick traversal, contract argument checks, and rate limits |
| RPC/DB/Redis outage or stale data | False success or unsafe write | Readiness checks and fail-closed writes; never return success-shaped fallbacks |
| Wallet phishing or blind signing | User signs a malicious transaction | Show network, operation, assets, amounts, bounds, and destination; never auto-submit unsigned XDR |
| Secret leakage through logs or telemetry | Account compromise | Redaction, structured safe errors, no XDR/private-key logging, and fixture secret scanning |
| Client bundle compromise or dependency attack | Malicious code reaches sign flow | Locked dependencies, reviewed entrypoints, CSP/deployment controls, and reproducible CI |
| Contract bug or upgrade/admin compromise | Loss of pooled funds | Independent audit, least-privilege roles, timelocks/multisig where applicable, and a documented pause/rollback plan |

## Abuse cases and fail-closed behavior

- An attacker may replay any request, alter every browser field, race a quote,
  or make dependencies return errors. No client-only check is a security
  boundary.
- Unknown contract errors are surfaced as failures with a correlation id.
  They are never interpreted as success.
- Missing network configuration, unavailable write dependencies, invalid
  addresses, expired auth, wrong roles, and failed signatures reject the
  operation. There is no default network, default role, or retry that changes
  transaction intent.
- Mainnet-affecting changes require an explicit feature flag or kill-switch,
  testnet verification, an operator checklist, and a rollback path.

## Detection and response

Money-path metrics must cover signing rejection, submission failure,
slippage/deadline rejection, authorization failure, RPC dependency health, and
latency. Logs may include a correlation id, operation class, network, and
outcome, but never secrets, raw credentials, or signed transaction payloads.
Operators use [`docs/OPS_DEPLOYMENT.md`](OPS_DEPLOYMENT.md) to disable risky
paths and [`SECURITY.md`](../SECURITY.md) to coordinate vulnerability response.

## Review checklist

Before release or a material DEX change, reviewers verify:

- [ ] The contract remains authoritative for balances, authorization, and settlement.
- [ ] Replay, stale quote, wrong network, dependency outage, and wallet rejection tests exist.
- [ ] New privileged surfaces are deny-by-default and rate-limited.
- [ ] Error codes and correlation ids are stable without leaking sensitive data.
- [ ] Mainnet rollout has a flag/kill-switch, monitoring, and rollback evidence.
