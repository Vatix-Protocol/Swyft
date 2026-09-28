# App Smoke Check (required CI)

`apps/api/src/app.smoke.spec.ts` boots the **entire** `AppModule` graph with
every external dependency stubbed (Prisma, Redis, BullMQ, Horizon), then
exercises it over HTTP. CI runs it as its own job, **`API smoke`**, which must
be a required status check on `main`. Tracking issue: #1029.

## What it guarantees

1. **The app boots.** Every module import resolves and every provider wires
   up. A PR that registers a module in `app.module.ts` without committing the
   file fails here.
2. **Core public routes answer 200:** `/`, `/health`, `/v1/pools`,
   `/v1/swaps`, `/v1/tokens`, `/v1/search`, `/v1/indexer/status`,
   `POST /v1/auth/nonce`.
3. **Privileged routes are deny-by-default.** Only `ApiKeyGuard` (public API
   keys) is overridden. Internal-key guards run for real, so the suite
   asserts 401 without credentials on:
   - `POST /v1/indexer/dead-letters/replay` (stable code + correlation id)
   - `POST /v1/indexer/replay`
   - `GET /v1/metrics/security`

   A privileged route that loses its guard fails the check.
4. **No live dependencies.** The job starts no Postgres or Redis, so a
   dependency outage can never make it flaky. It also means the suite catches
   any code that connects at import time.

## Running locally

```bash
pnpm --filter api test:smoke
```

It needs `pnpm db:generate` first (for the Prisma client types). No database is
required.

## Making it required (maintainers)

In GitHub → Settings → Branches → `main` protection rule → "Require status
checks to pass", add **`API smoke`**. The job `name` in
`.github/workflows/ci.yml` is what the rule matches, so don't rename it
without updating the rule.

## Adding a module

When you register a new module in `app.module.ts`:

- Commit every file it imports.
- If it connects to an external service at startup, stub that in the smoke
  spec's mocks. Don't skip the test.
- If it adds a privileged route, add a no-credentials assertion to the
  "privileged routes without credentials" block.

## Rollback

The check only reads code. To stop blocking merges in an emergency, remove
`API smoke` from the branch protection rule. Leave the job itself in place.
