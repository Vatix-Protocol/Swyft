# Stellar Wave issue labeling policy

This policy keeps Stellar Wave work discoverable and prevents operationally
significant DEX changes from being treated as routine documentation or UI
tasks. Labels are metadata for triage; they never grant authorization to
deploy, change contracts, or bypass review.

## Required labels

Every Stellar Wave issue must have `Stellar Wave` and at least one area label:

| Area | Use for |
| --- | --- |
| `documentation` | Policies, threat models, runbooks, and contributor guidance |
| `frontend` | Wallet, trading, liquidity, and settlement user experience |
| `sdk` | Public SDK APIs, package exports, build, and compatibility |
| `backend` | API, indexing, RPC, database, and operational services |
| `contracts` | Soroban contracts, migrations, deployment, and address manifests |
| `testing` | Test infrastructure, fixtures, and verification gaps |

Add `enhancement`, `bug`, or `security` when the issue type is known. Add
`hard` when the work spans multiple packages, changes a money path, or needs
protocol expertise. `good first issue` is only appropriate when the acceptance
criteria are independently actionable without privileged access or protocol
changes.

## Triage rules

1. The issue author adds `Stellar Wave` and an area label before asking for
   implementation. A maintainer may add or correct labels during triage.
2. If an issue affects balances, swaps, liquidity, signing, settlement,
   authentication, or deployment, also add `security` or `hard` as
   appropriate and link the relevant threat model or runbook.
3. If scope is unclear, use `needs-triage` and do not use `good first issue`.
   The label must be removed before implementation starts.
4. Labels must describe the issue's primary surface, not the contributor's
   skill or the expected reward. Do not use labels to imply review, approval,
   bounty eligibility, or release readiness.
5. A pull request should preserve the issue's labels and link the issue. If
   implementation reveals a second surface, add its area label rather than
   silently changing the scope.

## Ownership and review

Maintainers own label definitions and may rename or retire labels. A change to
this policy requires maintainer review and a documentation-only pull request.
Security-sensitive issues must use the private disclosure process in
[`SECURITY.md`](../SECURITY.md), even if they also qualify for Stellar Wave.

The authoritative list is the repository's GitHub label configuration. This
document defines how labels are applied; it does not create labels
automatically.
