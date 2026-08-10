FROM node:22-alpine AS base

# --- Install pnpm ---
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Deps layer (cache-friendly) ---
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

# --- Build layer ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# --- Production image ---
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 app && \
    adduser --system --uid 1001 app

# Copy built artifacts and runtime deps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/tsconfig.json ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app
EXPOSE 3020

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/indexnow.db

CMD ["node", "--import", "tsx", "src/server/index.ts"]
