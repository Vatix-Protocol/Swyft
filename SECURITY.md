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

- **Reentrancy** — cross-contract call ordering
- **Arithmetic overflow/underflow** — fixed-point math edge cases
- **Access control** — admin function exposure
- **Oracle manipulation** — TWAP price manipulation vectors
- **Tick arithmetic** — off-by-one errors in concentrated liquidity math
- **Storage exhaustion** — unbounded storage writes

---

## SDK Security Model (`@swyft/sdk`)

The SDK exposes high-level swap and liquidity APIs. These are **client-side helpers only** — they never hold keys, sign transactions, or act as a source of truth.

### Trust boundaries

- **Server/contract is the source of truth** for balances, swap execution, pool state, and admin actions. SDK results (quotes, pool queries) are advisory and MUST be re-validated on-chain.
- **No secrets in the SDK.** The SDK never accepts, stores, or logs private keys, seed phrases, or signing material. Signing is delegated to the caller's wallet (e.g. Freighter).
- **Deny-by-default authz.** Privileged surfaces (admin, treasury, config) are not exposed through the SDK's public entrypoints. Any privileged call requires an explicit, caller-supplied authorization context; absent or invalid context fails closed.

### Network passphrase guards

Every SDK entrypoint that touches liquidity, trading, or settlement paths is gated by a **network passphrase guard** that runs before any operation executes. The guard is fail-closed: if it cannot positively confirm the configured network, the operation is rejected.

- **Expected network is explicit.** The SDK is constructed with an expected network (testnet or mainnet) and the corresponding Stellar network passphrase. There is no implicit default and no silent fallback.
- **Guard runs first.** The guard validates the configured passphrase against the expected network before any quote, execute, add/remove liquidity, or settlement call proceeds. Untrusted callers cannot bypass it by supplying their own passphrase or network.
- **Fail-closed on mismatch.** A missing, malformed, or mismatched passphrase (e.g. testnet passphrase against a mainnet expectation, or vice versa) causes the operation to be rejected with a stable, documented error code. The SDK never proceeds on an unverified network.
- **Stable error codes.** Guard failures surface a stable, machine-readable error code plus a correlation id, consistent with the SDK's error model. Messages MUST NOT leak secrets or internal topology.
- **No address drift.** The guard prevents testnet vs mainnet address drift: the SDK never silently falls back to a different network's addresses or passphrase.

### Swap & liquidity entrypoints

- **Quote** (`quote`) is read-only and side-effect free. It MUST NOT mutate state or trigger writes.
- **Execute** (`execute`) and liquidity mutations (`addLiquidity` / `removeLiquidity`) are money-path operations. They:
  - require an explicit authorization context and fail closed when it is missing, expired, or has the wrong role;
  - carry a caller-supplied **idempotency key** so concurrent or replayed requests cannot double-execute;
  - fail closed on dependency outages (RPC/DB/Redis) — no partial writes, no silent retries that could duplicate a swap.
- **Stable error codes.** All SDK errors surface a stable, machine-readable code plus a correlation id for support and audit trails. Error messages MUST NOT leak secrets or internal topology.

### Observability

- Metrics and logs on money paths (quote, execute, add/remove liquidity) are ops-safe: they record counts, latency, and stable error codes — never keys, signatures, or raw payloads containing secrets.
- Correlation ids are propagated end-to-end so a client request can be traced without exposing sensitive data.

### Mainnet safety

- Money-path and mainnet-affecting SDK behavior is gated behind a feature flag / kill-switch. Rollback is documented in the PR that introduces the change.
- Testnet vs mainnet address drift is handled explicitly; the SDK never silently falls back to a different network's addresses.

---

## Disclosure Policy

Swyft follows **coordinated disclosure**:

1. Researcher reports privately.
2. Maintainer confirms and assesses the issue.
3. Fix is developed and tested.
4. Fix is merged and a release is tagged.
5. Public advisory is published with credit to the reporter (unless they prefer to remain anonymous).

We will not take legal action against security researchers who follow this policy and act in good faith.

---

## Bug Bounty

There is no formal bug bounty programme at this time. We will publicly acknowledge researchers who responsibly disclose valid vulnerabilities.

---

## Secrets

No secrets, tokens, or credentials are committed to this repository or written to logs.
