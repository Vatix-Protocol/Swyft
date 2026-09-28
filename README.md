# Swyft

Swyft is the liquidity, trading, and settlement surface of the Vatix-Protocol
monorepo. This repository ships the API service, the web client, and the
supporting infrastructure used to run them locally and in production.

## Repository layout

- `apps/api/` — the Swyft API service (HTTP + workers).
- `apps/web/` — the Swyft web client.
- `docker-compose.yml` — root compose file that orchestrates the full local stack.
- `apps/api/docker-compose.yml` — API-local compose file for running just the API and its dependencies.

## Local Docker / Compose

There are two compose files in this repo. They serve different purposes and are
not interchangeable. Use the one that matches what you are trying to run.

### Root `docker-compose.yml` — full stack

Purpose: orchestrate the complete local stack (API, web, database, cache, and
any supporting services) with shared networks and volumes. Use this when you
want to exercise the end-to-end product locally.

```bash
# from the repository root
docker compose up --build
```

Expected endpoints (defaults):

- Web client: http://localhost:3000
- API: http://localhost:8000
- API health: http://localhost:8000/health

### `apps/api/docker-compose.yml` — API-local

Purpose: run only the API service and the dependencies it needs (database,
cache) for focused API development and debugging. Use this when you are working
on the API alone and do not need the web client or the rest of the stack.

```bash
# from apps/api
cd apps/api
docker compose up --build
```

Expected endpoints (defaults):

- API: http://localhost:8000
- API health: http://localhost:8000/health

### How they relate

- The root compose file is the source of truth for the full local stack.
- The API-local compose file is a subset: it defines the API service and its
  direct dependencies only.
- Where the two files overlap (API service name, API port, API environment
  variable names, and the database/cache service names), they are kept
  consistent so that switching between them does not change how the API is
  configured.
- Intentional differences: the root file additionally defines the web client
  and any stack-wide services, and it owns the shared network/volume topology
  for the full stack. The API-local file does not define the web client.

If you change a shared value (API port, API env var name, database/cache
service name), update both compose files in the same change so they stay in
sync.

## Development

See `apps/api/README.md` for API-specific setup, and `apps/web/README.md` for
web client setup. For local Docker usage, prefer the compose guidance above.

## Security

See `SECURITY.md` for reporting and policy. Do not commit secrets; local
compose files must read credentials from environment variables or local
`.env` files that are git-ignored.
