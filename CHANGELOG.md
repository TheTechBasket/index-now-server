# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/) + [SemVer](https://semver.org/).

## [0.4.0] - 2026-08-26

### Added
- Delete-site action in the site edit dialog.
- Sitemap redirect/not-found/fetch-error Discord notification events.
- Sitemap host-mismatch and localhost-URL warnings, surfaced on the URL list page.

### Changed
- Bulk dashboard actions (submit/sync/verify) run sequentially with a small gap between sites instead of firing in parallel, avoiding rate-limit bursts.
- `.env.example` trimmed to grouped, one-line comments per variable.

### Fixed
- Docker build no longer silently succeeds on a failed `pnpm install`; install also skips the build-script approval gate on Alpine.
- Removed dead 403/429 backoff branch in cron runner (unreachable, `runSubmission` never throws).
- "Sync Sitemap" button no longer stays clickable during a sitemap-fix + re-sync, fixing a race.
- Sitemap warnings no longer full-scan the URL table on every paginated/search request.
- Bulk delete by ID now runs as one transaction instead of per-chunk commits.
- Em dashes removed from user-facing toast/banner copy.

## [0.1.0] - 2026-08-10

### Added
- Self-hosted IndexNow submission manager: site management, per-site API keys, sitemap tracking.
- Manual, scheduled (hourly/6h/daily/weekly/monthly), and webhook-triggered submissions.
- URL list with search, status filter, pagination, bulk actions (reset, prune, delete).
- Dashboard with submission stats and per-site sync status.

### Fixed
- Docker build for pnpm's build-script approval gate on Alpine (2026-08-26).

### Docs
- Simplified README; added screenshots.
