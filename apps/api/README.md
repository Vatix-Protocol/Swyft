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

| Service    | Default URL                                      |
|------------|--------------------------------------------------|
| NestJS API | http://localhost:3001                            |
| PostgreSQL | `postgresql://postgres:postgres@localhost:5432/swyft` |
| Redis      | `redis://localhost:6379`                         |

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
