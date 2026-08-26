FROM node:22-alpine AS base

# --- Install pnpm ---
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Deps layer (cache-friendly) ---
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile; \
    cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npx --yes node-gyp@latest rebuild --release

# --- Build layer ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ./node_modules/.bin/vite build

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
