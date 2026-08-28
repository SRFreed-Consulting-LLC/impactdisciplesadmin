# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Admin back-office app for Impact Disciples (events, store, requests, subscriptions, web content) —
Angular 20 + Angular Material, backed directly by Firebase (Firestore, Auth, Functions, Storage). No
server tier of its own besides Cloud Functions in `functions/`. This app was recently migrated off
DevExtreme onto Material (branch `migrate-from-devexpress`) — most list/table screens follow the
pagination + Columns/Export pattern described below rather than older DevExtreme-era code.

There are two sibling apps that share the same Firebase projects: the public site `impactdisciples-web`
and the patron Library Reader `impact-discipleship-library-new`. (The former standalone Library
Manager CMS, `impact-discipleship-library-manager-new`, was decommissioned 2026-08-16 and folded into
this app as the `library-manager` module; its folder may still exist on disk as a dead reference
shell.) They are not part of this git repo, but are reachable as sibling directories one level up
(`../impactdisciples - web`, `../impact-discipleship-library-new`, note the spaces) on a machine that
has them checked out side by side - worth checking for before assuming a cross-repo change is out of
reach. All three apps + `functions/` consume the same shared git submodule, `src/common`
(`impact-discipleship-library-common`, aliased `@impact-common/*`): its `src/shared/` slice holds the
web/admin domain models + enums + date util, `config/firebase-projects.ts` (project configs,
`functionUrl()`, app URLs, CORS origins) and `contract/*` (every Cloud Function's name and the
request/response types) - see the Cloud Functions section. Shared code changes go in the submodule
first (push it first), then bump the pointer in each consumer.

## Commands

```bash
# Run. LOCAL PORT RULE (2026-08-26): the thousands digit is the APP and the
# last digit is the BACKEND —
#     web 4200 | admin 5200 | reader 6200   → live data (impactdisciplesdev)
#     web 4201 | admin 5201 | reader 6201   → Firebase emulator
# Never Angular's default 4200 for this app. The backend digit matters: until
# it existed, `start-emu` also bound 5200, so a Playwright suite with
# `reuseExistingServer` could silently attach to whichever backend happened
# to be serving. Ports live in APP_URLS / LOCAL_APP_URLS in the shared
# submodule (src/common/src/shared/config/firebase-projects.ts) — import
# those rather than writing a localhost literal.
npm run start-local -- --port=5200      # local Firebase config, ng serve
npm run start-dev                       # development Firebase config
npm run start-prod                      # production Firebase config

# Build
npm run build-local
npm run build-dev
npm run build-prod

# Deploy (builds, switches `firebase use`, deploys hosting only)
npm run build-deploy-dev                # -> impactdisciplesdev project, hosting:development target
npm run build-deploy-prod               # -> impactdisciples-a82a8 project, hosting:production target

# Firestore data export (see scripts/export.js)
npm run backup:dev                      # node scripts/export.js --project=dev
npm run backup:prod                     # node scripts/export.js --project=prod

# Lint / format (Angular app)
npm run lint
npm run format
npm run format:check

# Unit tests (Karma/Jasmine)
npm run test                             # headless, watch=false (273+ specs)
npm run test:watch
ng test --include='**/products.component.spec.ts'   # single spec

# Legacy smoke E2E (Playwright vs the REAL dev project) — assumes the dev
# server is ALREADY running on port 5200 (`npm run start-local`, which now
# carries --port=5200 itself);
# playwright.config.ts does not auto-start it.
npm run e2e
npx playwright test e2e/smoke.spec.ts    # single spec

# EMULATOR-BACKED TEST PROGRAM (see the Test program section below)
# NOTE: `emu` pins firebase-tools 15.x via npx and does NOT use whatever
# firebase CLI is on your PATH. firebase-tools 14.x is incompatible with
# firebase-functions 7.x - its emulator runtime calls functions.config(),
# which v7 removed and whose replacement throws, killing the functions
# worker. The symptom is EVERY function failing "Failed to load function"
# and every integration test hanging ~300s before failing. Do not "simplify"
# this back to a bare `firebase emulators:start`. (Deploys still use the
# CLI on PATH - that path is unaffected and upgrading it is a separate call.)
npm run emu                              # start the Firebase Emulator Suite (demo-impact)
npm run emu:seed                         # wipe + reseed the deterministic fixture world
npm run test:integration                 # node:test over the REAL emulated functions
npm run test:rules                       # firestore.rules tests (@firebase/rules-unit-testing)
npm run e2e:cross                        # cross-app Playwright flows (admin+web+reader)
```

Cloud Functions live in `functions/` and are a separate npm project:

```bash
cd functions
npm run build          # tsc
npm run build:watch
npm run lint           # flat-config workaround baked in — see note below
npm run serve          # build + firebase emulators:start --only functions
npm run shell          # build + firebase functions:shell
npm run deploy-dev      # firebase use impactdisciplesdev && firebase deploy --only functions
npm run deploy-prod     # firebase use impactdisciples-a82a8 && firebase deploy --only functions
npm run logs
```

`functions/` runs on Node 22 / firebase-functions 7 / firebase-admin 14 / TypeScript 5.8 with an ESLint 9
flat config (`functions/eslint.config.js`: eslint + typescript-eslint recommended + the Google style
rules) since 2026-08-20 - the old ESLint 8 `.eslintrc.js` + `cross-env ESLINT_USE_FLAT_CONFIG=false`
workaround is gone. **Everything is 2nd-gen as of 2026-08-21** - the last four 1st-gen files
(`paypal`, `shipping`, `subscriptions`, `youtube`; `library-license-grant` was already v2 despite an
older version of this line claiming otherwise) moved to `firebase-functions/v2/https`. Nothing
imports `firebase-functions/v1` any more; new functions must not reintroduce it. Two things that
migration established and that a future one needs to know: **a deployed function's generation cannot
be changed in place** - firebase-tools hard-throws "Upgrading from 1st Gen to 2nd Gen is not yet
supported" with no `--force`, so each function must be `functions:delete`d and redeployed, and
because that throw aborts the whole deploy plan, half-migrated code blocks EVERY functions deploy in
that project until it is finished; and **2nd gen defaults to 80 concurrent requests per instance**
(1st gen served one at a time), so module-level mutable state is now shared across in-flight
requests - the existing module-level caches (`cachedClientId`, `CachedShipEngine`, library-paypal's
`tokenCache`) are all idempotent and safe, but anything request-scoped at module scope would not be.
Underscore function names (`create_paypal_order`) are fine in 2nd gen, and the
`cloudfunctions.net/<name>` URL is unchanged across generations, so client callers needed no edits.
firebase-admin moved to
14.x on 2026-08-21: use the MODULAR API only (`getFirestore()`, `getAuth()`, `getStorage()`,
`getApp()`, `applicationDefault()`, and `Timestamp`/`FieldValue`/`FieldPath`/`DocumentData` imported
from `firebase-admin/firestore`). v14's package root exports only App/initializeApp/getApp/
credential-factory/errors — the whole namespaced surface (`admin.firestore()`, `admin.auth()`,
`admin.storage()`, `admin.app()`, `admin.credential.*`) is gone. This applies to `scripts/` and
`integration/` too: they resolve firebase-admin out of `functions/node_modules` on purpose, and
`scripts/lib/firestore-admin.js` is their shared bootstrap (it exports the whole
`firebase-admin/firestore` module as `firestore`, the modular stand-in for the old namespace).

Firebase deploys of `functions/` predeploy-run `functions/`'s own `lint` and `build` (see
`firebase.json`).

## Test program (emulator-backed)

Built 2026-08-19/20. FOUR layers, all runnable locally, none of which can touch
impactdisciplesdev or prod (everything targets the local Emulator Suite under the fake
project id `demo-impact`):

1. **Unit** — Karma/Jasmine in this repo and the web repo (`npm run test` in each; the web
   repo's suite was created by this program), plus `functions/`'s own node:test suite
   (`cd functions && npm test`, runs against compiled `lib/`).

   **House style: hand-construct the class with duck-typed deps whenever you can** — it is
   faster, it has no framework in the failure path, and most of this suite is written that way.

   The old wording here said "NEVER TestBed/DI" and treated needing TestBed as a signal to move
   a dependency out of `inject()` and into the constructor. That is **no longer the rule**, and
   following it now would push new code away from the `inject()` direction all three apps are
   moving in. Distinguish the two things TestBed can do:

   - **TestBed as an injector** — `TestBed.configureTestingModule({ providers: [...] })` plus
     `TestBed.inject(Thing)`. Cheap, no template compilation, and it works for BOTH DI styles.
     Reach for it without hesitation when the class under test uses `inject()`, or when it
     owns signals (which need an injection context). `campaign-detail.component.spec.ts` and
     `library-groups-list.component.spec.ts` are the pattern.
   - **TestBed with `compileComponents()` / `createComponent()`** — a real component
     lifecycle and a rendered template. Slow, and it drags in every child component. Only do
     this when the TEMPLATE itself is what you are testing; asserting on class behaviour does
     not need it.

   So: hand-construct by default, TestBed-as-injector when DI or signals require it, rendered
   TestBed only for templates. A spec needing an injector is not a smell to refactor away.
2. **Integration** (`integration/`, `npm run test:integration`, emulator must be up) — the REAL
   Cloud Functions running in the emulator, driven over HTTP/callables + Admin-SDK doc writes:
   registration flow, customer upserts, checkout money path, campaign send engine + tracking,
   library license grants. `integration/helpers/emulator.js` is the harness;
   `integration/dao-semantics.test.js` pins the client-SDK contracts FirebaseDAO depends on.
3. **Rules** (`integration/rules/`, `npm run test:rules`) — firestore.rules over
   @firebase/rules-unit-testing v4 (own `demo-rules`/`demo-reader-rules` namespaces, safe
   alongside everything else). TWO files, both run by that one command: `firestore-rules.test.js`
   (node:test; staff `role`-claim + anonymous populations, 15 assertions) and `reader-rules.js`
   (its own tiny harness, 31 assertions over the email-keyed patron population — the license
   paywall, self-license-grant lockdown, group/roster/invite enumeration, inbox messages, the
   pre-auth errorLogs exception). The reader file **moved here from the reader repo 2026-08-21**:
   it always read this repo's rules by a cross-repo relative path, so it now lives beside the
   file it tests. Emulator must be up (`npm run emu`) and Java installed.
4. **Cross-app E2E** (`e2e-cross/`, `npm run e2e:cross`) — Playwright flows spanning the admin
   (:5201), web (:4201), and reader (:6201) apps, each served with its `emulator` build
   configuration (`npm run start-emu` in each repo; `playwright.cross.config.ts` starts/reuses
   them). The old `e2e/` suite remains as a live-dev smoke layer.
5. **Admin E2E** (`e2e-admin/`, `npm run e2e:admin`, added 2026-08-21) — one app, one emulator,
   the whole admin back office swept by FUNCTIONAL AREA. Exists because most admin breakage is
   single-app UI breakage (a route moved, a lazy chunk broke, a grid stopped rendering) and
   booting the web + reader dev servers to catch it is waste. `e2e-admin/support/areas.ts` is
   the area registry; each spec tags itself `[area-id] Title` and the reporter groups by that.

   **What belongs here vs. in `integration/`:** integration owns the data and money truths
   (purchase → license grant, refunds, customer upserts, the send engine) — a browser adds only
   latency to a Firestore assertion. This layer owns what the browser is uniquely able to break.
   The campaigns rewrite of 2026-08-21 is the case in point: it changed no Cloud Function, so
   every integration test stays green whether the campaign editor works or is a blank page.
   `03-campaign-email.spec.ts` is the only thing in the repo that would notice.

   `npm run e2e:admin:dashboard` renders `e2e-admin/results/dashboard.json` (written by
   `support/dashboard-reporter.ts`) into a red/yellow/green page per functional area, each
   failure carrying a plain-language explanation and a suggested fix. Areas with NO test report
   as untested rather than green — the failure mode of every dashboard that only counts what ran.

Fixture world: `scripts/fixtures/emulator-fixtures.js` (deterministic ids — summit
`event-summit-2027`, coupons FREE100/SAVE10, seeded accounts `admin@test.local` /
`employee@test.local` / `patron@test.local`, password `test-password-1`).
`scripts/seed-emulator.js` is wipe-first + idempotent; it WAITS for the emulator's trigger
backlog to go quiet and then writes session-count truth, because the emulator wipe fires DELETE
triggers for the entire previous world (don't "optimize" that away).

Two hard-won emulator facts: (a) functions must import `Timestamp`/`FieldValue` from the
`firebase-admin/firestore` SUBPATH — the functions emulator's module proxy drops the
`admin.firestore.*` namespace statics at runtime (deployed functions don't care; the emulator
crashes). Keep new functions code on subpath imports. (b) `functions/.env.local` +
`.secret.local` (fake vendor values, gitignored) are generated by `scripts/write-emulator-env.js`
as part of `npm run emu`. Those files no longer just make vendor calls fail — since 2026-08-26
they REDIRECT PayPal, the apilayer tax service and ShipEngine at the fake vendor server (below).

### Fake vendors (PayPal / tax / ShipEngine)

`scripts/fake-vendors.js` stands in for the three paid third parties on
**port 5055**, one server routed by path. `npm run emu` starts it (via
`scripts/start-emu.js`, which health-checks it before spawning the emulator so
a cold function can never hit ECONNREFUSED); `npm run fake-vendors` runs it
alone.

**Why it exists.** The money path was the least-covered code in the repo
precisely because it was the most expensive to run. Before this: the fixture
world had no `config` doc, so `create_paypal_order` threw at
`getPaypalClientId()` before any network call and every paid test could only
assert a generic 400; `capture_paypal_order` had NO coverage at all (a real
capture needs buyer approval in a browser, so it cannot be automated even
against sandbox); the Georgia tax branch was actively steered around (money
tests use a Texas address on purpose); and `get_shipping_label` could never be
tested because a passing test would buy real postage. All four are now covered
— see `integration/vendor-money.test.js` (20 tests),
`integration/vendor-shipping.test.js` (8), and `e2e-cross/13-paid-checkout.spec.ts`
(the UI-driven paid checkout, which previously could not reach the payment step
at all).

**How functions reach it.** `functions/src/utils/vendor-hosts.ts` resolves each
vendor's base URL, honouring `FAKE_VENDOR_{PAYPAL,TAX,SHIPENGINE}_BASE` **only**
when `FUNCTIONS_EMULATOR=true` or the project id starts with `demo-`. Anywhere
else the override is ignored and loudly logged — failing closed onto the real
vendor. That guard is a security control, not plumbing: an override that took
effect on a deployed project would let anyone who can set an env var point real
payment verification at a server they control. `functions/test/vendor-hosts.test.js`
is its test.

**Driving scenarios.** `POST /__control` sets knobs (declined capture, amount
mismatch, non-COMPLETED status, OAuth 401, token lifetime, order-create
failure); `/__reset`, `/__log` and `/__orders` are the rest of the control
plane. Failure modes go through `__control` rather than through order data
because production code owns the request body. **Tax is the exception** — it is
keyed off well-known Georgia zips (30301 real rate, 30302 a 500, 30303 a hang
past the 3s timeout, 30304 a malformed body), because the test controls the
address.

**Two caches will bite you**, and both are correct behaviour rather than bugs:
- `library-paypal.ts` caches an access token for `(expires_in - 60)` seconds per
  warm instance. The fake therefore issues **60-second** tokens by default, so
  the TTL is zero and every call re-exchanges — otherwise the first checkout of
  a run caches a 9-hour token and no later test can observe PayPal auth at all.
  A cached token CANNOT be evicted from outside the instance, so a test that
  raises the lifetime must pick one short enough to lapse on its own.
  `vendor-money.test.js` probes for a poisoned cache in `before()` and fails with
  an instruction rather than a mystery.
- Tax rates cache per zip for 12 hours. Any test asserting that a lookup
  actually happened must use a **zip unique to the run**; a fixed one is already
  cached the second time the suite runs against the same emulator.

**Vendor drift — the real limitation.** A fake proves OUR logic, never PayPal's.
If a vendor changes a field name this suite stays green and production breaks.
The mitigation is a periodic MANUAL run against PayPal **sandbox** before a
release, refreshing the fake's canned bodies from what sandbox actually returns.
Automated coverage does not replace that check.

## Branches

`development` is the ONLY branch in this repo, and the GitHub default. As of 2026-08-23 every
merged branch was deleted (14 local + 3 remote here), and neither `main` nor `master` exists any
more — ignore any tooling default that assumes one. Production is deployed straight from
`development`; there is no prod branch to merge to.

That removes the old "never touch `master`" guard, so the caution now attaches to the deploy
commands themselves: `build-deploy-prod` and `firebase deploy --project impactdisciples-a82a8`
publish whatever is on `development` immediately. Confirm intent each time — a general "push to
prod" is not standing permission.

## Firebase projects

- `impactdisciplesdev` — dev, hosting target `development`, site `impactdisciplesdev-admin`.
- `impactdisciples-a82a8` — prod, hosting target `production`, site `impactdisciples-admin`.

Config selection is via Angular build configurations (`local`/`development`/`production`), each
swapping in `src/environments/environment-{local,development,production}.ts` — these hold the
Firestore config and Cloud Function URLs for that environment; `environment.local.ts`
points at the `impactdisciplesdev` Firebase project (there's no separate local emulator setup).

`firestore.rules` is a real, unified ruleset now (the old wide-open `if true` gap was closed) —
ONE file owned by THIS repo covering all three client populations (anonymous public web, admin
staff via a `role` custom claim synced from `admin_users` by `onAdminUserRoleSync`, email-keyed
reader patrons); the web/reader repos deliberately deploy no Firestore rules. Cloud Functions use
the Admin SDK and bypass rules entirely — `write: false` on a functions-written collection is
intentional lockdown, not breakage. Read the rules file's own header comment before editing;
`npm run test:rules` covers it. `storage.rules` is staff-gated as of 2026-08-20.

## Architecture

### Data access: DAO → Service → Component, one pattern for every collection

- **`FirebaseDAO<T>`** (`src/app/common/dao/firebase.dao.ts`) — generic wrapper around
  `@angular/fire/firestore` giving every model type `getAll`/`getById`/`add`/`update`/`delete`,
  `getAllByValue`/`queryByValue`/`queryAllByMultiValue`, live `streamAll`/`streamByValue`/`streamById`,
  and paged one-time `getPage()` (cursor-based via `startAfter`, not offset). There's also
  `streamAllOrdered()` (server-side `orderBy`, meant to pair with a `limit`). Live `stream*` methods
  do NOT retry — a jittered-retry layer existed briefly but was a misdiagnosis and was removed
  2026-08-15; don't re-add it. On terminal error they log, invoke the optional `onError` callback,
  and fall back to emitting `[]`; recovering means subscribing fresh.
- **Firestore write gotcha: never assign an optional field the literal value `undefined`.** An
  object literal with a key explicitly set to `undefined` is not the same as that key being absent —
  `setDoc()`/`update()` reject the *entire* write ("Unsupported field value: undefined") the moment
  any field, however deeply nested, is explicitly `undefined`. Live-diagnosed 2026-08-14 in
  `PurchasesService.withStatusHistory()`: `by?: string` was always assigned from
  `currentUserLabel()`, which can itself return `undefined` (its display-caching cookie can lapse
  independently of the real Firebase Auth session), silently failing every fulfillment-status
  transition whenever that happened. Fix pattern: build the optional field conditionally
  (`...(value ? { key: value } : {})`) rather than assigning it unconditionally, so the key is
  omitted rather than present-with-`undefined`.
- **`BaseService<T>`** (`src/app/common/services/data/base.service.ts`) — thin per-collection
  wrapper around the DAO; every entity service (`ProductService`, `ContactService`, etc.) extends
  this and just sets `table` (the Firestore collection name) and optionally `fromFirestore`
  (a deserialization hook).
- Feature components inject their entity service directly and call `streamAll()` for small/live
  reference data (categories, series, tags) or the paginated path (see below) for large collections.

### Pagination (Products, Contacts, Log Messages today)

Large tables have been moved off `streamAll()` (an always-on `onSnapshot` over the whole collection)
onto one-time paged fetches, to cut down on standing Firestore listeners:

- `FirebaseDAO.getPage()` / `BaseService.getPage()` — one `orderBy` + `startAfter` + `limit` fetch,
  returns `{ items, cursor, hasMore }`.
- `PagedCollectionSource<T>` (`src/app/shared/paged-collection-source.ts`) — client-side accumulator
  a component constructs with a `getPage`-shaped fetch function; exposes `rows$`, `loading$`,
  `loadingMore$`, `hasMore$`, `loadFirstPage()`, `loadNextPage()`.
- `appInfiniteScroll` directive (`src/app/shared/infinite-scroll.directive.ts`) +
  `<app-paged-table-footer>` (`src/app/shared/data-grid/paged-table-footer/`) — scroll-triggered
  "load more" plus a "N loaded" footer indicator.
- Firestore's `orderBy()` silently excludes any doc missing that field — if you add pagination to a
  new table, confirm every existing record actually has the `orderByField` set.
- New tables should follow this pattern (see `products.component.ts` for the fullest example) rather
  than reintroducing whole-collection `streamAll()`.
- Customers is no longer a special case here (an earlier version of this doc said the grid pagination
  coexisted with a separate full `getAll()` backing "Filter by List"/"Save List" on that screen — that
  affordance is gone post-redesign; `customers.component.ts` today is `PagedCollectionSource` only, no
  `allCustomers`). List-membership filtering is now gone app-wide — the Subscribers report briefly
  carried a "Filter by List" criterion after absorbing the old screen, but that was dropped too
  (commit `8aa09f1`); there is no saved-list building anywhere. See that report's section below.

### List-screen conventions (Columns + Export + column filters)

Every migrated list screen (`products.component.ts` is the canonical example) shares the same shape:
a `ColumnDef[]` array driving a Columns-visibility menu, `<app-column-filter>`
(`src/app/shared/data-grid/column-filter/`) per-column filter row backed by `matchesColumnFilter()`
(`column-filter.model.ts`), and an `exportExcel()` using `exportToExcel()`
(`src/app/shared/table-export.util.ts`) that exports whatever's currently visible/filtered on
screen. `<app-list-header>` (`src/app/shared/list-header/`) renders the action buttons (New,
Columns, Export, feature-specific actions) uniformly.

### Auth

- `FireAuthDao` (`src/app/common/dao/fireauth.dao.ts`) wraps Firebase Auth directly (sign-in,
  password reset, `currentUser$`).
- `AdminAuthService` (`src/app/common/forms/admin/admin-auth.service.ts`) is the app-level auth
  facade: signs in via `FireAuthDao`, then looks the signed-in email up in `admin_users` (via
  `AdminUserService`) to load the app's own `AdminUser` profile, and caches it in a **client-side,
  unsigned** cookie (`impact-disciples-user`) purely for display/profile caching.
- `authGuard` (same file) — a functional guard (`CanActivateFn`, not a class-based `CanActivate`) —
  gates every route. **It must check Firebase Auth's own session state (`currentUser$` + a live
  `getIdTokenResult()` check), never the cookie** — the cookie is forgeable from devtools and is not
  treated as proof of authentication. See the `SECURITY` comment on `authGuard` before touching this.
- Login is a single email+password form (`src/app/common/forms/admin/login/`, copied from
  `impact-discipleship-library-manager-new`). There is no self-service account creation in this app —
  Admin User Firebase Auth accounts are created via the `createAdminUser` Cloud Function (Admin-role
  only), which triggers a password-reset email; there's no path for a new Admin User to set their
  own first password from within this app.
- Admin/staff identity for **Cloud Functions** is separate from the client guard: `requireStaffAuth()`
  (`functions/src/utils/security.functions.ts`) verifies a Firebase Auth ID token, confirms the
  caller's email exists in the `admin_users` collection, **and checks their `role` against an
  allowed set** (default `BUSINESS_STAFF_ROLES` = Admin/Root/Employee, mirroring `firestore.rules`'
  `isBusinessStaff()`; pass a narrower set for a tighter gate). Until 2026-08-27 it checked only
  that the row existed, so an **Editor** — the library-content tier that rules, nav and
  PermissionService all exclude from business screens — could take their ID token and buy real
  postage via `get_shipping_label`. Every function that moves money or deletes data must call it.
  CORS origin-checking (`restrictedCors`, same file) is still a browser-side courtesy, not an auth
  boundary, since Origin headers are trivially spoofed outside a browser — but it does now actually
  reject a disallowed origin with a 403. It previously FAILED OPEN: `cors` signals a rejected
  origin by calling `next(err)`, and every call site passed an argument-less arrow that discarded
  it, so the handler ran regardless. It is now a wrapper function with the same name and signature,
  so no call site can reintroduce that.

### Module/routing structure

Feature areas are lazy-loaded NgModules off `AppRoutingModule` (`src/app/app-routing.module.ts`),
each gated by `authGuard`: `admin-manager` (Admin Users, Log Messages — both `hideFromNav`, reached
from the user-menu dropdown, not the left nav), `events-manager`, `contacts-manager`,
`content-manager`, `store-manager`, `tools-manager`, `reports-manager`. **App-wide vocabulary
rename 2026-08-19 (user-requested): "Customers" → "Contacts" and "Web Manager" → "Content
Manager"** — `customers-manager` became `contacts-manager` (folder, module, routes, screenKeys,
labels; the Customers screen is now Contacts, `CustomerService`/`CustomerModel` are
`ContactService`/`ContactModel`), `web-manager` became `content-manager`, and Web Config moved
from Tools Manager into Content Manager. The **Firestore collection is still `customers`**
(`ContactService.table`), the customer-upsert Cloud Functions keep their names, and the old
routes redirect (`app-routing.module.ts`). Stored permission grants were key-migrated by
`scripts/migrate-screenkey-renames.js` — already run on dev; **must be run on prod when this
ships to prod**. **Contacts & Events restructure 2026-08-19** (branch
`feature/contacts-events-restructure`, both repos — see MIGRATION.md's own entry for the prod
runbook): Organizations moved from `events-manager` into `contacts-manager`
(`contacts-manager/organizations/` — master list + in-page details with a Point of Contact card,
child Locations table, and Members list over `ContactModel.organizationId`); the standalone
Locations screen is retired (locations are child records of an org, `location.organization` = org
id, edited inside the org details view; the collection stays top-level `locations` because the
public site reads it); events pick Organization → optional Location and every save writes a
denormalized `EventModel.venue` `{name, address}` snapshot that the PUBLIC SITE renders (its
`VenuePipe`; `organizations` stays staff-only readable, staleness accepted, re-save refreshes);
Summits are pinned to the one `isSummitVenue` location (Crossroads HWY 16 — set by
`scripts/pin-summit-venue.js`, no UI writes it) whose rooms are edited via the Summit Info tab's
Venue Rooms panel; the **Courses concept is retired** (breakout agenda items carry their own
`text`/`description`/`coaches` — `scripts/flatten-courses-onto-agenda-items.js` backfilled from the
old course docs; `AgendaItem.course` is frozen legacy provenance; registrations were ALREADY
agenda-item-keyed so nothing moved); and qualifying form submissions offer an admin-reviewed
"Create Organization + Contact" / "Create Contact" action (`create-org-contact-dialog` in shared,
driven by the label heuristics in `shared/form-submission-mapping.util.ts` — the ONE sanctioned
admin-side contact creation, email-deduped, never overwrites existing profiles). There is no
`subscriptions-manager` module any more — it was absorbed into what's now `contacts-manager` as a
screen, then that screen itself was removed outright 2026-08-15 once
subscriber management folded into Reports Manager's own Subscribers report instead (see that
section below) — there is no dedicated subscriber-management screen left anywhere, just that report.
There is no `requests-manager` module either — its one surviving screen, Custom Form Submissions, has moved twice (originally its
own module, briefly under `content-manager`) and now lives under `contacts-manager`
(`custom-form-submissions/`) as of the August 2026 nav reorg; the other four Requests Manager
screens (Consultation Requests/Surveys, Lunch and Learn, Seminar) were removed outright, superseded
by the generic Form Builder (`tools-manager`) + Custom Form Submissions pair. `contacts-manager`
also owns Purchases/Fulfillment, not `store-manager` — `store-manager` today is Products, Coupons,
Sales, affiliate-sales/affiliate-payments, product-categories, product-series. `tools-manager` holds
Email Templates, Shipping Labels, and Form Builder (Web Config moved to `content-manager`
2026-08-19, see the rename note above); Mailchimp Settings moved to
`campaigns-manager` 2026-08-18 (it's campaign-audience infrastructure — see the Email taxonomy
note below). `reports-manager`
is new — see below. `events-manager` exposes two separate nav screens, **Summit** and **Events** —
both render the same `EventsComponent`, just with `[summitMode]` true/false: Summit is `isSummit`
events only, Events is regular events, and each has its own permission grant (an existing Events
grant deliberately does not carry over to Summit — see the comments in `nav-config.ts`). Regular
events keep a plain `list`/`edit` mode pair; summit mode adds three more (`EventsComponent.mode`):
`hub` — "Mission Control" (`summit-hub/`), what opening a summit row lands on (user decision
2026-08-19: an operations overview of stat tiles/milestones/cards, with editing one click deeper in
the existing tab editor — Info/Application/Agenda); `attendees` — the full-page attendee Command
Center (`summit-command-center/`); and `wizard` — the New Summit guided setup
(`summit-setup-wizard/`, with copy-from-previous-summit via `summit-copy.util.ts`). A live preview
rail (`summit-preview-rail/` hosting `summit-preview/`) renders the attendee-facing view alongside
editing; derived stats live in `summit-stats.util.ts`. All mode switching stays in
`EventsComponent`; child surfaces emit navigation upward. `src/app/core/main-screen/` is the shell (top bar + nav) wrapping the
`dashboard` home route and all feature module outlets. `src/app/shared/` holds cross-feature
UI (list header, column filter, dialogs, image uploader, table export/loading, paged-table
infrastructure) and is imported by every feature module. This codebase is NgModule-based, and most of it
still uses constructor injection — but **`inject()` is the direction, and it is what new or
refactored code should use** (owner decision; corrected here 2026-08-28, when this section still
read "constructor injection throughout, not `inject()`" and was being quoted to argue against the
direction all three apps are actually moving in).

What that means in practice:

- **New code, and code you are already rewriting: use `inject()`.** Do not convert untouched files
  one at a time — a wholesale conversion is its own piece of work, not something to smuggle into an
  incidental change. Both styles compile and neither lints as an error
  (`@angular-eslint/prefer-standalone` and `prefer-inject` are both `off` in `eslint.config.js`),
  so this is a convention, not a guardrail.
- **Write specs TestBed-as-injector** (`TestBed.runInInjectionContext`, or
  `configureTestingModule` + `TestBed.inject`) rather than `new`-ing the class with duck-typed
  deps, so they survive a class moving to `inject()`. See the Test program section.
- **MIXING THE TWO IN ONE CLASS HAS A REAL TRAP, and it has already bitten.** `inject()` runs in
  FIELD INITIALIZER order, so a field that calls `inject()` must be declared *before* any field
  whose initializer depends on it. And a spec that constructs the class with `new` throws
  **NG0203** the moment that class takes anything via `inject()` — which is exactly what happened
  to `designer-side-panel.component.spec.ts` on 2026-08-27 when the panel gained
  `inject(DomSanitizer)`. The fix was to construct inside `TestBed.runInInjectionContext`, not to
  move the dependency back to the constructor.

`library-manager/**` remains the largest `inject()`+signals island (it came in from the
decommissioned standalone Library Manager with its own house style) and is slated for a wholesale
restructure. The two FUNCTIONAL route guards (`authGuard` in `admin-auth.service.ts`,
`libraryUnsavedChangesGuard`) MUST stay on `inject()` — a `CanActivateFn`/`CanDeactivateFn` has no
constructor, so there is no alternative there. (The `*ngIf`/`*ngFor` → `@if`/`@for`
control-flow migration was a separate, smaller lift and was completed codebase-wide on
2026-08-12 via `ng generate @angular/core:control-flow-migration`; `@angular-eslint/template/prefer-control-flow`
is back on at `error` in `eslint.config.js` now that it's done — don't reintroduce `*ngIf`/`*ngFor`/`*ngSwitch`
in new code.)

Which modules own which screens has moved more than once (see above) — don't assume a screen's
module from memory or an old link; check `nav-config.ts` or `app-routing.module.ts` first.

### Nav config as permission registry (`src/app/core/main-screen/nav-config.ts`)

`NAV_CONFIG` (`NavGroup`/`NavLeaf`/`NavTab`) drives the left nav *and* doubles as the permission
registry: each entry's id/slug/key forms a dot-path "screenKey" that `ScreenPermission` grants are
checked against. `employeeGrantable` and `roles` flags control whether a screen can be granted to
Employee-role admins at all vs. is Admin-only; `hideFromNav` marks screens reached some other way
(user-menu dropdown, nested detail pages) that still need a screenKey for permissioning. See
`src/app/common/services/permission.service.ts` and `permission-migration.service.ts` for how grants
are read/enforced. `nav-config.ts`'s header comment documents the August 2026 reorg rationale
("around what a screen actually IS rather than which internal app area happened to own it") — read
it before adding a new screen or moving an existing one between modules.

### Reports Manager (`src/app/reports-manager/`)

A report is a screen over one collection with its own filters/exports.
**Full detail: `docs/reports-manager.md`** - read it before adding or
changing a report.


### `MIGRATION.md`

Repo-root running list of known Firestore data-integrity issues and their defensive fixes — most
notably inconsistent date-field shapes (real `Timestamp` vs. a malformed `{seconds,nanoseconds}` map
vs. an ISO string) that can break sort order or silently exclude documents from range queries; the
defensive fix is the `toMillis()` helper in `src/common/src/shared/utils/date-from-timestamp.ts`
(the SHARED SUBMODULE since 2026-08-20 - a change there reaches web and reader too, so push the
submodule first and bump each consumer's pointer; `functions/` keeps its own deliberate mirror in
`utils/date-normalize.functions.ts`). Check it
before writing any new query or sort against a date field, and add to it when you find a new
data-shape gotcha rather than working around it silently in one screen.

### Email Builder, Cloud Functions, email vocabulary

Three areas whose detail lives outside this file so it is loaded only when
it is actually needed:

- **`docs/email-builder.md`** - the drag/drop builder at
  `src/app/tools-manager/email-designer/`, its design JSON and the one-way
  legacy-template conversion.
- **`functions/CLAUDE.md`** - the Cloud Functions codebase layout,
  the shared-code sync, and how they are deployed. Picked up automatically
  when working in `functions/`.
- **`docs/email-taxonomy.md`** - the agreed vocabulary for system vs
  campaign email. **Read it before naming anything in this domain**; the
  words are load-bearing across three repos.


### Firestore collection naming note

The Admin Users collection is `admin_users` (renamed from `users`; see commit `3ffcbd4`) — both the
Angular `AdminUserService` and the Cloud Functions' `requireStaffAuth()` were updated together. The
old `users` collection is still present in Firestore but intentionally unused/orphaned pending
verification — don't resurrect it as a source of truth.

Newsletter/Prayer Team subscriber state used to be its own `subscriptions` collection (itself already
a merge of 2 even older `newsletter_subscriptions`/`prayer_team_subscriptions` collections) — it's now
2 booleans + dates (`subscribedToNewsletter`/`newsletterSubscribedDate`,
`subscribedToPrayerTeam`/`prayerTeamSubscribedDate`) directly on the matching `customers` doc instead
(see `ContactModel`'s own comment (contact.model.ts), and `functions/src/subscriptions.functions.ts` for the 2 endpoints
that flip those flags from outside the admin app). Reports Manager's Subscriber Report (the sole
remaining subscriber-management screen - see its own section above) queries `customers` by these
flags now, not a `subscriptions` collection. Unlike `users` above, the old `subscriptions`
collection itself is gone (deleted 2026-08-15 in both dev and prod, after the one-time backfill script
— see `MIGRATION.md` — was run and verified idempotent on both, `impactdisciples-web`'s subscribe form
was confirmed pointed at the new `subscribe_to_email_list` endpoint instead of writing to it directly,
and the 2 now-orphaned `onSubscriptionCreated`/`onSubscriptionUpdated` Cloud Functions were deleted).

`coaches` used to serve 2 unrelated purposes at once: driving the public site's "My Team" page
(via a `teamPageSortOrder` field) AND providing Summit breakout-session instructors. Split 2026-08-15
into `coaches` (Events Manager > Coaches - breakout-only now, no `teamPageSortOrder`) and `impact_team`
(Web Manager > Team Page - the public-facing half, its own `sortOrder`; see `ImpactTeamMemberModel`/
`ImpactTeamService`). Anyone who had `teamPageSortOrder` set was moved (not copied) into `impact_team`
under the same document id — see `scripts/move-team-page-coaches-to-impact-team.js` and `MIGRATION.md`
— specifically so any existing `CourseModel.coachIds` referencing that id keeps resolving correctly
post-split with zero data changes needed on the course side. A breakout instructor can still come from
either collection: the Agenda dialogs' Coaches pickers are combined, grouped (`<mat-optgroup>` per
source, tagged via `Instructor.source`), and every place that resolves a coach id to a display name
(`coachLabelFor()` in `session-block.util.ts`, the Agenda wizard/canvas/grid) works off one merged
array assembled once in `event-agenda.component.ts`. Since the 2026-08-19 restructure, NEW coaches
are created ONLY via the Summit agenda dialogs' "+ Add new coach to this event"
(`coach-quick-create-dialog` — name + optional title, deliberately slim) and never Impact Team
members; the Events Manager > Coaches roster is EDIT-ONLY (photo/bio/organization upkeep, no New
action), and Impact Team members are administered via Content Manager > Team Page.
`impactdisciples-web`'s own "My Team" page (`team.component.ts`/
`team-details.component.ts`) was updated separately, same day, to read `impact_team` instead of
`coaches` - see that repo's own commit and this file's Firestore collection naming note above for the
full picture. NOTE: the parenthetical that used to sit here claimed both repos' `common/` were
independent copies "no longer a shared submodule" - that is WRONG and was corrected 2026-08-26.
`src/common` is a real git submodule (`impact-discipleship-library-common`) in this repo AND in the
web and reader repos - see .gitmodules and `git submodule status`. A shared-code change is: commit
and push the SUBMODULE first, then bump the pointer in each consumer. App-local code (this repo's
own services, screens and DAO) still does not propagate and has to be changed per repo.
