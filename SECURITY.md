# Security Policy

## Scope

This policy covers the Swyft monorepo, including:

- Soroban smart contracts (`packages/contract/`)
- NestJS backend API (`apps/api/`)
- TypeScript SDK (`packages/sdk/`)
- Next.js frontend (`apps/web/`)

> **Important:** Swyft contracts are **unaudited**. Do not deploy to mainnet or use with real funds until a security audit has been completed and published.

---

## Supported Versions

| Component | Supported |
|---|---|
| `main` branch | ✅ Yes |
| Tagged releases | ✅ Yes |
| Other branches | ❌ No |

---

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.** Public disclosure before a fix is available puts users at risk.

### How to report

Send a report by email to the maintainer via GitHub. You can find the contact by navigating to the [repository owner's profile](https://github.com/Valreb001) and using the email listed there, or by opening a **private** [GitHub Security Advisory](https://github.com/Valreb001/Swyft/security/advisories/new).

### What to include

A useful report includes:

1. **Description** — what is vulnerable and what the potential impact is
2. **Reproduction steps** — a minimal example that demonstrates the issue
3. **Affected component** — which package, contract, or endpoint is affected
4. **Suggested fix** (optional) — if you have one

### What to expect

| Step | Timeline |
|---|---|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix or mitigation | Depends on severity — critical issues are prioritised immediately |
| Public disclosure | After a fix is merged and released |

---

## Severity Classification

We follow the [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) scoring framework:

| Severity | CVSS Score | Examples |
|---|---|---|
| Critical | 9.0–10.0 | Fund drainage, permanent contract lock |
| High | 7.0–8.9 | Privilege escalation, fee manipulation |
| Medium | 4.0–6.9 | Denial of service, info disclosure |
| Low | 0.1–3.9 | Minor logic errors, non-exploitable edge cases |

---

## Smart Contract Specific Guidance

Soroban contracts present unique risks. When reporting contract vulnerabilities, please consider:

- **Reentrancy** — cross-contract call ordering
- **Arithmetic overflow/underflow** — fixed-point math edge cases
- **Access control** — admin function exposure
- **Oracle manipulation** — TWAP price manipulation vectors
- **Tick arithmetic** — off-by-one errors in concentrated liquidity math
- **Storage exhaustion** — unbounded storage writes

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
