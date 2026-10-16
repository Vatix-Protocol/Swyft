# syntax=docker/dockerfile:1

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter web...

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they must be present as build args here — setting them only at runtime has
# no effect on the compiled JavaScript.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_URL_TESTNET
ARG NEXT_PUBLIC_API_URL_PUBLIC
ARG NEXT_PUBLIC_SWYFT_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL_TESTNET=$NEXT_PUBLIC_API_URL_TESTNET
ENV NEXT_PUBLIC_API_URL_PUBLIC=$NEXT_PUBLIC_API_URL_PUBLIC
ENV NEXT_PUBLIC_SWYFT_API_KEY=$NEXT_PUBLIC_SWYFT_API_KEY

RUN pnpm --filter web build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
