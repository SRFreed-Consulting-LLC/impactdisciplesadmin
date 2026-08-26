---
description: Run the E2E suites on the right ports/backends and publish results to the Root-only dashboard
---

Which suites: **$ARGUMENTS** (e.g. `all`, `admin-smoke`, `cross`, `reader`).
Default to `all` if nothing is given.

## Port rule — check this FIRST

Thousands digit is the APP, last digit is the BACKEND:

|        | live dev data | Firebase emulator |
|--------|---------------|-------------------|
| web    | 4200          | 4201              |
| admin  | 5200          | 5201              |
| reader | 6200          | 6201              |

`admin-smoke` and `web-e2e` declare **no `webServer`** — they use whatever
answers their port. Before running either, confirm what is actually listening;
a wrong-app or wrong-backend server produces failures that look like product
bugs. (On 2026-08-26 port 4200 was serving the READER while the cross config
expected web there, which made e2e-cross look flaky for weeks. It was not.)

## The suites

| suite | backend | how |
|---|---|---|
| `e2e-admin` | emulator :5201 | `npm run e2e:admin` (self-starts its server) |
| `e2e-cross` | emulator | `npm run e2e:cross` (self-starts all three) |
| `admin-smoke` | live dev :5200 | needs `npm run start-local` already running |
| `web-e2e` | live dev :4200 | needs web's `npm run start-local` already running |
| `reader-e2e` | live dev :6200 | node scripts in the reader repo, `npm run e2e:<area>` |

Emulator-backed suites need `npm run emu` up (and Java). It rebuilds functions,
so restart it after changing function code or you test the old build.

## Two dev fixtures must STAY seeded

`scripts/seed-e2e-popup.js` and `scripts/seed-e2e-groups.js`. Do NOT `--remove`
them out of habit: without them 20 web specs skip themselves silently. The
popup's full-screen overlay used to break 11 other specs, which is why they
were seeded-then-deleted; `impactdisciples - web/playwright.config.ts` now
ships a `storageState` pre-dismissing that fixture, so it can stay.

## Publishing to the dashboard

```bash
node scripts/publish-e2e-run.js --suite=<id> --project=dev  --from-dashboard=e2e-admin/results/dashboard.json
node scripts/publish-e2e-run.js --suite=<id> --project=prod --passed=N --failed=N --flaky=N --skipped=N
```

Publish to **both** dev and prod — the Root-only E2E Dashboard in admin reads
`e2e_runs` from whichever project it is running against. Suite ids must match
`src/common/src/shared/testing/e2e-catalog.ts`; a typo writes a doc nothing
joins to and the suite silently reads "Never run".

Skipped counts report as **unreliable** (yellow) on purpose — a skipped test
verifies nothing. Do not paper over it by passing `--status=passed`.

## Reading results honestly

- **A reader script can print `PASS:` and still exit non-zero.** Check for the
  PASS line before believing a timeout; `exit 124` after a green run means the
  process could not exit, not that the test failed.
- **Screenshots in `scripts/.output/` are the most reliable diagnostic.**
  Several failures have reported misleading causes ("no licensed books" for an
  account with four) that only the screenshot disproved.
- **Don't pass `--reporter=...` on the CLI** for the admin suite: it overrides
  the config's dashboard reporter and `results/dashboard.json` never refreshes.
