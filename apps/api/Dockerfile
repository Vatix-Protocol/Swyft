FROM node:20-slim AS base
RUN npm install -g pnpm@8.15.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/tsconfig.base.json packages/config/
COPY packages/contract/package.json packages/contract/
COPY packages/sdk/ packages/sdk/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/sdk/dist ./packages/sdk/dist
COPY . .
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/swyft
RUN pnpm db:generate
RUN pnpm --filter api build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --chown=node:node --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --chown=node:node --from=builder /app/packages/sdk/dist ./packages/sdk/dist

USER node
WORKDIR /app/apps/api
EXPOSE 3001

CMD ["node", "dist/main"]
