---
description: Deploy the Impact Suite to dev and/or prod in the safe order, with the traps that have actually bitten
---

Deploy target: **$ARGUMENTS** (e.g. `dev`, `prod`, `functions dev`, `reader prod`).
If no target is given, ask which project and which pieces before doing anything.

## Order is not cosmetic — follow it

1. **Functions + indexes** (only if they changed)
2. **Hosting**: admin → reader → web
3. **Rules + storage LAST**, after the web deploy

Why 1 before 2: a client that ships before the function it depends on can take
a real payment the old server then rejects. That is exactly what would have
happened with the 2026-08-26 coupon change — the client would have charged
PayPal the discounted total while the old function computed the undiscounted
one and refused the capture, leaving "your payment succeeded but we could not
record your licenses".

Why 3 is last: the pre-change web build may still read what the new rules close.

## Commands

```bash
# Functions - ONE function where possible; a whole-codebase deploy invites 429.
firebase deploy --only "functions:NAME" --project impactdisciplesdev
firebase deploy --only "functions:NAME" --project impactdisciples-a82a8

# Hosting
cd "impactdisciples - admin"          && npm run build-deploy-dev   # or -prod
cd "impact-discipleship-library-new"  && npm run deploy:dev         # or :prod
cd "impactdisciples - web"            && npm run build-deploy-dev   # or -prod
```

## Traps, all previously hit

- **Run function deploys from PowerShell, not Git Bash.** The predeploy hook
  fails to spawn under bash.
- **`spawn npm --prefix "%RESOURCE_DIR%" run lint ENOENT` is a MASK.** The real
  error is printed ABOVE it — usually an eslint `max-len` in a file you just
  touched. Read past the ENOENT. To avoid the round trip entirely, run
  `cd functions && npm run lint` BEFORE deploying.
- **HTTP 429 "Per project mutation requests"** is not a failure. Run the same
  command again; what already went reports "Skipped (No changes detected)".
- **"Failed to list functions"** is transient. Retry.
- **Quote the `--only` value in PowerShell.** Unquoted `a,b` becomes a PS array
  and the CLI reports "No function matches given --only filters".
- **A rules-only deploy does NOT deploy indexes.** Deploy the combined
  `firestore` target, or a missing composite index surfaces later as a
  generic-looking access-denied error.

## Before prod

- Confirm the suites are green (`/e2e` publishes them to the dashboard).
- Prod is `impactdisciples-a82a8`; dev is `impactdisciplesdev`. There is no
  prod BRANCH — `development` is the only branch in every repo, so "push to
  prod" always means deploy, never merge.
- A hosting-only release cannot touch Firestore, so it needs no `backup:prod`.
  A functions/rules/data deploy does — run it first.

## After

Verify the live URLs actually answer (PowerShell `Invoke-WebRequest`; curl in
Git Bash intermittently reports HTTP 000 against endpoints that are fine):
`impactdisciples.com`, `library.impactdisciples.com`, and the `*.web.app` hosts.
