# Onboarding: Getting web + api + db running quickly

This doc is the fast path for a new contributor to get the full Swyft stack (web, api, db) running locally with minimal steps.

## Prerequisites
- Node.js + pnpm installed
- Docker (for local Postgres via `docker-compose.yml`)

## Quick start
1. Clone the repo and install dependencies: `pnpm install`
2. Copy environment files:
   - `apps/api/.env.example` -> `apps/api/.env`
   - `apps/web/.env.example` -> `apps/web/.env` (if present)
3. Start the database: `docker-compose up -d`
4. Run Prisma migrations/generate against the local db (see `prisma/` for schema).
5. Start the API: `pnpm --filter api dev`
6. Start the web app: `pnpm --filter web dev`

## Notes
- `docker-compose.yml` at the repo root brings up the local Postgres instance used by `apps/api`.
- `prisma/` holds the schema shared by the API; run generate/migrate before starting `apps/api` for the first time.
- See `CONTRIBUTING.md` for coding conventions and `docs/ARCHITECTURE.md` for how `apps/api` and `apps/web` fit together.

## Open items to streamline further
- [ ] Add a single `pnpm dev` (or `make dev`) script that boots db + api + web together.
- [ ] Add a `.env.example` presence check/script so missing env vars fail fast with a clear message.
- [ ] Confirm minimum Node/pnpm versions and pin them in `package.json` engines field.
