# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
(https://github.com/Vatix-Protocol/monorepo/security/advisories/new) or by emailing
security@vatix.example. Do not open public issues for security reports. We aim to
acknowledge reports within 72 hours.

## Scope

This policy covers the Swyft packages in this monorepo, including the API service,
contracts, and deployment registries. The server and on-chain contracts remain the
source of truth for balances, swaps, and admin actions; clients are never trusted to
enforce policy.

## Testnet Registry Wasm Hash Redeploy Discipline

The testnet deployment registry (`packages/contract/deployments/testnet.json`) records
the wasm hashes that are live on testnet. It is a security-relevant artifact and is
governed by the following invariants:

1. **Source of truth.** `testnet.json` is the single source of truth for testnet wasm
   hashes. No other file, script, or environment variable may override it at runtime.
2. **Immutability of deployed hashes.** A hash that has been recorded for a deployed
   contract is immutable. Redeploying a contract requires a new entry (new contract id
   or an explicit, reviewed supersede) rather than silently mutating an existing hash.
3. **Testnet vs mainnet separation.** Testnet and mainnet registries are distinct
   files and must never be cross-read. A testnet hash must never be promoted to mainnet
   without the mainnet readiness checklist.
4. **Address drift detection.** Any mismatch between the registry hash and the hash
   reported by the chain (RPC) is treated as drift and fails closed: reads surface a
   stable error code, and writes are rejected until the registry is reconciled.

### Authorization

Registry reads and validation are available to authenticated callers. Any mutation or
redeploy entrypoint is deny-by-default: it requires an explicit privileged role and is
rate-limited. Untrusted clients cannot mutate the registry or bypass policy.

### Idempotency and Fail-Closed Behavior

Redeploy requests carry a correlation id and are idempotent: concurrent or replayed
requests with the same id resolve to a single applied change. If a dependency (RPC,
DB, or Redis) is unavailable, writes fail closed — the registry is left unchanged and
the caller receives a stable error code rather than a partial or optimistic update.

### Observability

Registry validation and redeploy paths emit metrics and structured logs (including the
correlation id) without leaking secrets. Money-path operations are instrumented so
failures are actionable.

### Rollback

Redeploy changes are feature-flagged. Disabling the flag restores the previous registry
behavior without requiring a code revert; the rollback procedure is documented in the
corresponding PR description.

## Secrets

No secrets, tokens, or credentials are committed to this repository or written to logs.
