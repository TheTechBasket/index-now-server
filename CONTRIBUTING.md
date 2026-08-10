# Contributing to IndexNow Server

Thanks for your interest in improving IndexNow Server! This is a small,
single-process app, so the contribution flow is intentionally light.

## Project layout

```
src/server/   Fastify API, Drizzle schema, auth, submission engine, cron
src/client/   React SPA (Vite root, served by Fastify in production)
drizzle/      generated SQL migrations (applied at boot)
```

One `package.json`, no monorepo. Don't split it.

## Setup

```bash
pnpm install
pnpm dev    # http://localhost:3000 — API + Vite HMR on one port
```

First visit prompts you to create the admin account. The SQLite database is
created automatically at `./data/indexnow.db`.

## Before opening a PR

Run these locally:

```bash
pnpm exec tsc --noEmit      # typecheck the whole project
pnpm build                   # production build (Vite client bundle)
```

There is no lint step yet — `tsc` is the source of truth for correctness. If
you add ESLint later, wire it into a CI workflow under `.github/workflows/`.

## Schema changes

Schema lives in `src/server/db/schema.ts`. Drizzle Kit generates the SQL:

```bash
pnpm db:generate             # write a new migration under drizzle/
```

Commit the generated `drizzle/000X_*.sql` **and** the `drizzle/meta/*` files.
Migrations run automatically at boot (`src/server/db/index.ts`).

Never hand-edit a generated migration — regenerate it instead.

## Submitting changes

- Open a PR against `main`.
- Keep the scope tight — one feature or fix per PR.
- Describe **what** changed and **why**; the reviewer shouldn't have to read
  the diff to understand intent.
- If you change UI, attach a screenshot or short screen recording.
- Don't bump the version in `package.json` — maintainers do that on release.

## Things to know

- **Auth is a simple env gate, not a user system.** There is no users table —
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` control dashboard access. Don't
  add a user registration flow or per-user data ownership.
- **Single admin by default.** Per-user settings and `user_id` on `sites` are
  deliberately deferred — discuss before adding them.
- **One port.** Fastify serves the API and the React SPA on the same port via
  `@fastify/vite`. Don't introduce a second dev server or a separate client
  build step.
- **SQLite only.** Don't add Postgres/MySQL code paths. If you need a feature
  SQLite can't do, open an issue first.

## Reporting bugs

Open an issue and include:

1. IndexNow Server version (`git rev-parse HEAD` if running from source).
2. Node version (`node -v`).
3. Steps to reproduce.
4. Expected vs actual behaviour.
5. Relevant log lines from the server console.

Don't paste your `AUTH_SECRET`, API keys, or webhook secrets.
