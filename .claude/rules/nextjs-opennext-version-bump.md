# Next.js Bump PR — Check the Preview URL Before Merging

## Rule

This project is Next.js on Cloudflare Workers via `@opennextjs/cloudflare`.
OpenNext trails Next.js releases: an "obviously safe" Renovate/dependabot
minor/patch bump of `next` can go fully green — CI (lint / typecheck /
test) **and** the `Deploy` workflow's `opennextjs-cloudflare build` +
version upload — and still 500 at request time, because the break is in
the Worker's runtime bootstrap.

Rule: **don't merge a `next` bump PR on green checks alone.** Open the
PR's Cloudflare Workers preview URL (the repo's `Deploy` workflow posts
it as a sticky PR comment — `Version Preview URL: …`) and load the top
page. Only merge if the preview responds 2xx and renders.

Same discipline applies to `@opennextjs/cloudflare` bumps (same failure
surface, opposite side).

## Why

`opennextjs-cloudflare build` + version upload succeed even when the
runtime combination (Next + OpenNext + Workers) is broken — the failure
is at Worker startup, in OpenNext's manifest loader, not at build. Only
the actual deployed Worker exercises that path. The PR preview deploy
IS that Worker, so it's the cheapest oracle. Checks-green ≠
preview-green for this class.

## How to apply

- Fires on any dep PR touching `next` or `@opennextjs/cloudflare` in
  `package.json`. Automated PRs (Renovate, dependabot) are the main
  case, but manual bumps too.
- Read the sticky preview comment (tri-state):
  - `⏳ deployment is in progress` → wait for the `Deploy` workflow.
  - `Version Preview URL: <url>` → GET `/`. 5xx / "Worker threw
    exception" / Cloudflare Error 1101 → do **not** merge; investigate.
  - `❌ deployment failed` → the bump already fails at build/upload;
    read the `Deploy` job log; do **not** merge.
  - Comment absent entirely → deploy the branch manually before merge.
- On a runtime failure at the preview URL, get the raw exception via:
  `pnpm exec wrangler tail dreamvision --format=json` then hit the
  preview URL again. Look for `outcome: "exception"` +
  `exceptions[].message`. If tail shows no events for preview-URL hits
  (unverified whether tail captures preview-version traffic), fall back
  to the CF dashboard's Workers observability logs (`observability.enabled`
  is on in `wrangler.json`) or reproduce against the deployed Worker in
  a throwaway deploy.
- If the failure is in OpenNext (`loadManifest`, `.open-next/*`, worker
  bootstrap): pin `next` to the last known-good version exact (no `^` —
  e.g. `"next": "15.5.20"`) and check the `@opennextjs/cloudflare`
  release notes / issues for a fix of the _specific causing symptom_
  (the crashing manifest / loader / bootstrap path), not just a blanket
  "supports Next vX" claim — a general support statement can lag the
  actual fix.
