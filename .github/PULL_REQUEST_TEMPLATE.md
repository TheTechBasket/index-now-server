<!--
Thanks for the PR! Keep the scope tight — one feature or fix per PR.
Run `pnpm exec tsc --noEmit && pnpm build` before pushing.
-->

## What changed

<!-- 1–3 sentences. "What" before "why". -->

## Why

<!-- The problem or motivation. Reviewer shouldn't have to read the diff to understand intent. -->

## How

<!-- Brief walkthrough of the approach. Mention anything tricky or any trade-offs you made. -->

## Verification

- [ ] `pnpm exec tsc --noEmit` passes
- [ ] `pnpm build` passes
- [ ] Manually tested in the browser (attach a screenshot/clip if UI changed)

## Notes for the reviewer

<!-- Anything you want eyes on: edge cases, naming choices, things you're unsure about. -->

## Checklist

- [ ] No secrets, API keys, or `AUTH_SECRET` values in the diff
- [ ] Schema changes use `pnpm db:generate` — no hand-edited migrations
- [ ] Didn't bump `package.json` version (maintainers do that on release)
