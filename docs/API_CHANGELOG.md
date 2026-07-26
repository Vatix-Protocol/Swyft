# API Changelog (Breaking Changes)

This file tracks breaking changes to the `apps/api` REST surface. Any change that alters a response shape, removes/renames a field or endpoint, or changes required request parameters must be logged here.

## Format
Each entry should include:
- Date
- Endpoint(s) affected
- What changed and why
- Migration notes for consumers

## Unreleased

_No breaking changes logged yet. Add entries above this line as they happen._

---

## How to use this file
When making a breaking REST change in `apps/api`:
1. Add a new dated entry to this changelog in the same PR as the change.
2. Note any client-side (`apps/web`) updates required and whether they're included in the same PR.
3. If the change affects external/third-party consumers, call that out explicitly.
