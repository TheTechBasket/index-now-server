# Security Policy

## Supported versions

Only the latest release on `main` is supported. There are no LTS branches
and no backports — update to the latest version before reporting.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email the maintainer instead. If you found this through a fork and don't
have a contact, open a private GitHub Security Advisory
(`Security` → `Advisories` → `New advisory`) on the repo.

Please include:

- A clear description of the issue and its impact.
- Steps to reproduce, including any crafted requests.
- The version you tested against (`git rev-parse HEAD` or the image tag).
- Suggested fix, if you have one.

You'll get an acknowledgement within 7 days. Coordinated disclosure
happens once a fix is shipped (or after 90 days, whichever comes first).

## Hardening checklist (for self-hosters)

These are operator concerns, not application bugs, but worth noting here:

- **Set `AUTH_SECRET`** to a strong random value
  (`openssl rand -base64 32`). Empty/weak secrets invalidate the
  threat model of the entire app.
- **Front the app with TLS** (Caddy, nginx, Cloudflare Tunnel, …). The app
  itself only listens on plain HTTP; session cookies must be served over
  HTTPS to be secure.
- **Restrict the port** to a private network or behind a reverse proxy.
  Don't expose port `3020` directly to the internet without TLS.
- **Back up `./data/indexnow.db`** — it's the only state the app holds.
- **Rotate IndexNow keys** if you suspect a leak — the dashboard has a
  per-site "Rotate key" action. Old keys stop working the moment the new
  key file is deployed.
- **Don't commit `.env`.** It's in `.gitignore` already; keep it that way.

## What's in scope

- Authentication bypass, session fixation, CSRF on auth endpoints.
- SSRF or RCE via sitemap fetching, webhook handling, or the submission engine.
- SQL injection through Drizzle queries.
- XSS in the React dashboard.

## What's **out** of scope

- IndexNow protocol behaviour on the upstream `api.indexnow.org` side.
- Bugs in third-party engines (Bing, Yandex, Naver, Seznam) ingesting your
  submissions.
- Disclosing secrets you paste into public GitHub issues.
