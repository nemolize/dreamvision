# Next.js Bump PR — Check the Preview URL Before Merging

## Rule

This project is Next.js on Cloudflare Workers via `@opennextjs/cloudflare`.
OpenNext trails Next.js releases: an "obviously safe" Renovate/dependabot
minor/patch bump of `next` can pass CI (which only runs local `build` /
`lint` / `typecheck`) and still 500 in production because OpenNext hasn't
caught up to a new manifest / output shape Next introduced.

Rule: **don't merge a `next` bump PR on green CI alone.** Open the PR's
Cloudflare Workers preview URL (Renovate posts it in the PR body / the CF
GitHub check) and load the top page. Only merge if the preview responds
2xx and renders.

Same discipline applies to `@opennextjs/cloudflare` bumps (same failure
surface, opposite side).

## Why

`next build` succeeds locally & in CI even when the runtime combination
(Next + OpenNext + Workers) is broken — the failure is at Worker startup,
in OpenNext's manifest loader, not at build. Only the actual deployed
Worker exercises that path. The PR preview deploy IS that Worker, so it's
the cheapest oracle. CI-green ≠ preview-green for this class.

## How to apply

- Fires on any dep PR touching `next` or `@opennextjs/cloudflare` in
  `package.json`. Automated PRs (Renovate, dependabot) are the main case,
  but manual bumps too.
- Open the PR's preview URL → GET `/`. 5xx / "Worker threw exception" /
  Cloudflare Error 1101 → do **not** merge; investigate.
- On a runtime failure, tail the Worker to see the raw exception:
  `pnpm exec wrangler tail dreamvision --format=json` then hit the preview
  URL again. Look for `outcome: "exception"` + the `exceptions[]` message.
  Local `pnpm build` success proves nothing about this class.
- No preview URL on the PR → treat it as a gap and either wait for the CF
  preview to attach or deploy the branch manually before merge.
- If the failure is in OpenNext (`loadManifest`, `.open-next/*`, worker
  bootstrap): pin `next` to the last known-good minor rather than chase
  OpenNext, and check the `@opennextjs/cloudflare` release notes / issues
  for "supports Next vX" before re-attempting.
