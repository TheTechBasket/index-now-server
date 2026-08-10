# IndexNow Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org)

Self-hosted dashboard for managing [IndexNow](https://www.indexnow.org/) submissions:
keys, sitemaps, domains, and submission policies for any number of sites, from one
place. Pushes URL changes to Bing, Yandex, Naver, Seznam and every other
participating engine via `api.indexnow.org`.

## Features

- **Multi-site management** — add sites, auto-generate IndexNow keys, rotate them,
  copy them from the dashboard. Bulk Submit / Sync / Verify / Delete across many
  sites at once.
- **Sitemap diffing** — fetches your sitemap (indexes supported), submits only URLs
  not already submitted, batches up to 10,000 per request. Re-submits pages whose
  sitemap `lastmod` changed.
- **Three submission levels per site**:
  - `manual` — click Submit in the dashboard
  - `scheduled` — hourly / every 6 h / daily cron
  - `webhook` — `POST /hook/:siteId` with `X-Webhook-Secret` header from your CMS
    or build pipeline, with an optional `{ "urls": [...] }` body
    (omit to run a full sitemap diff)
- **Key file helper** — the dashboard surfaces the exact `<key>.txt` file content
  with Copy and Download buttons, so you can deploy the key file in one step.
- **Discord notifications** — optional webhook with per-event toggles
  (run success / no changes / errors / key-verification failures) and a test button.
- **Single admin account** — optional login gate read from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
  in `.env`. Data is never tied to a user, so you can change the admin credentials
  any time without touching your sites. Set `AUTH_ENABLED=false` to run unauthenticated.
- **One process** — Fastify serves the API and the React dashboard on one port.
  SQLite on disk, no external services.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3020 — API + HMR on one port
```

Add a site, host the generated key at `https://<host>/<key>.txt`, and submit.

## Auth

Simple, optional login gate. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` (use a
strong password — 12+ chars — we warn but never block), and the dashboard asks you
to sign in before showing anything. 

Auth is off when `AUTH_ENABLED=false` or when the admin vars are empty. When auth is
disabled, the dashboard loads directly without a login prompt, and the "Sign out" button
is hidden from the navigation header. Your data (sites, URLs, submissions) is never tied
to the admin account, so changing the credentials in `.env` never touches it.

## Production

```bash
pnpm build
AUTH_SECRET=$(openssl rand -base64 32) pnpm start
```

See `.env.example` for all settings (`PORT`, `DATABASE_PATH`, `AUTH_SECRET`).
The SQLite database lives at `./data/indexnow.db` by default; back that file up and
you've backed up everything.

## Deploy to Cloud 🚀

One-command deploy with Docker Compose to any VPS or cloud provider.

### Docker Compose (any VPS)

```bash
# Clone the repo
git clone https://github.com/TheTechBasket/index-now-server.git
cd index-now-server

# Set your secret and start
AUTH_SECRET=$(openssl rand -base64 32) \
  ADMIN_EMAIL=admin@example.com \
  ADMIN_PASSWORD=your-strong-password \
  docker compose up -d
```

Open `http://your-server:3020` and sign in — the admin account comes from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. That's it.

### One-click deploy options

[![Deploy to DigitalOcean](https://img.shields.io/badge/DigitalOcean-%230167ff?style=for-the-badge&logo=digitalocean&logoColor=white)](https://m.do.co/c/YOUR_DO_REFERRAL_ID)
[![Deploy to Hetzner](https://img.shields.io/badge/Hetzner-%23d50c2d?style=for-the-badge&logo=hetzner&logoColor=white)](https://hetzner.cloud/?ref=YOUR_HETZNER_REFERRAL_ID)
[![Deploy to Railway](https://img.shields.io/badge/Railway-%23171717?style=for-the-badge&logo=railway&logoColor=white)](https://railway.com/referral/YOUR_RAILWAY_REFERRAL_ID)

| Provider | How to deploy |
|----------|---------------|
| **DigitalOcean** | Spin up a $6/mo Droplet with Docker, SSH in, and run `docker compose up -d`. Use [this link](https://m.do.co/c/YOUR_DO_REFERRAL_ID) to get $200 free credit (referral). |
| **Hetzner** | Create a €3.79/mo CAX11 VPS with Docker, SSH in, run the same command. Use [this link](https://hetzner.cloud/?ref=YOUR_HETZNER_REFERRAL_ID) to get €20 free credit (referral). |
| **Railway** | Click the button above, set `AUTH_SECRET` as a variable, and deploy from the Railway dashboard — they handle Docker for you. [Referral link](https://railway.com/referral/YOUR_RAILWAY_REFERRAL_ID). |

> **Want to use your own referral links?** Fork the repo and replace `YOUR_DO_REFERRAL_ID`,
> `YOUR_HETZNER_REFERRAL_ID`, and `YOUR_RAILWAY_REFERRAL_ID` in `README.md` with your own
> IDs from each provider's referral dashboard.

### Minimal VPS requirements

| Spec | Minimum |
|------|---------|
| CPU | 1 vCPU |
| RAM | 512 MB |
| Disk | 5 GB |
| Docker | Yes |

Runs comfortably on any $4–6/mo VPS. SQLite means no external database needed.

## Stack

Fastify + [@fastify/vite](https://vite.fastify.dev/) · Drizzle + better-sqlite3 ·
React + shadcn/ui + Tailwind v4 · node-cron

```
src/server/   Fastify, Drizzle schema, auth, submission engine, cron
src/client/   React SPA (Vite root)
drizzle/      generated SQL migrations (applied automatically at boot)
```

One `package.json`, no monorepo. `src/server` and `src/client` are folders, not
packages.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions.
Run `pnpm exec tsc --noEmit && pnpm build` before pushing.

## Security

Found a security issue? See [SECURITY.md](SECURITY.md). **Do not open a public
issue for security problems.**

## License

[MIT](LICENSE) — © IndexNow Server contributors.
