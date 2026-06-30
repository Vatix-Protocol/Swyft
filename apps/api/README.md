# Swyft API

NestJS backend for the Swyft concentrated liquidity DEX.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2
- [pnpm](https://pnpm.io/)
- Node.js ≥ 20

## Environment setup

```bash
cp .env.example .env
```

All values in `.env.example` match the Docker Compose defaults — no changes needed for local development.

## Starting the stack

```bash
# Start Postgres + Redis, then NestJS in watch mode
pnpm dev
```

`docker compose up -d --wait` is run automatically before NestJS starts. Both services must pass their healthchecks before the app boots.

To start only the infrastructure (without NestJS):

```bash
docker compose up -d --wait
```

## Resetting the database

```bash
docker compose down -v
docker compose up -d --wait
```

The `-v` flag removes the named `postgres_data` volume, giving you a clean database.

## Service endpoints

| Service    | Default URL                                           |
| ---------- | ----------------------------------------------------- |
| NestJS API | http://localhost:3001                                 |
| PostgreSQL | `postgresql://postgres:postgres@localhost:5432/swyft` |
| Redis      | `redis://localhost:6379`                              |

## Health and CORS

`GET /health` returns `{ status, checks: { postgres, redis } }`; status is
`ok` only when both dependency probes pass. CORS allows `WEB_APP_ORIGIN` (or
`CORS_ORIGIN`) as a comma-separated origin list and defaults to
`http://localhost:3000`.

## Indexer recovery

Each successfully persisted indexer event with a valid `ledger` field advances
the monotonic `indexer:last_ledger` high-water mark in Redis and Postgres. The
Postgres `indexer_cursor` row remains the durable recovery source when Redis is
cold or unavailable. BullMQ retries stalled jobs, Prisma upserts keyed by
`eventId` make the replay safe after a worker restart, and jobs that exhaust
their retries are recorded in `indexer_dead_letter` for operator recovery.

## Running tests

```bash
pnpm test          # unit tests
pnpm test:e2e      # end-to-end tests
pnpm test:cov      # coverage report
```

## Stopping the stack

```bash
docker compose down
```

## Horizon indexer

Set `POOL_CONTRACT_ID` and, optionally, `HORIZON_URL` to enable the poller.
It reads Horizon effects every five seconds, converts recognized
`pool_created`, `swap_processed`, `position_minted`, and `position_burned`
events to BullMQ jobs, and stores its paging cursor in `indexer_cursor`.

Each job uses the Horizon event ID as its stable idempotency key. The workers
retain the raw event tables for auditability and project the data into the
canonical `Pool`, `Token`, `Swap`, and `Position` tables. Position events must
include their pool-local `tokenId`; `liquidity` is the resulting position
liquidity, so a value of `0` closes the position.
