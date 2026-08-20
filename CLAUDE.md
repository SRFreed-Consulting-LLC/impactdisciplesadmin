# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Admin back-office app for Impact Disciples (events, store, requests, subscriptions, web content) —
Angular 20 + Angular Material, backed directly by Firebase (Firestore, Auth, Functions, Storage). No
server tier of its own besides Cloud Functions in `functions/`. This app was recently migrated off
DevExtreme onto Material (branch `migrate-from-devexpress`) — most list/table screens follow the
pagination + Columns/Export pattern described below rather than older DevExtreme-era code.

There is a sibling public-facing app, `impactdisciples-web`, and another admin-style app,
`impact-discipleship-library-manager-new`, that share the same Firebase projects and some copied
patterns (e.g. the login screen). They are not part of this git repo, but they are reachable as
sibling directories one level up (`../impactdisciples - web`, `../impact-discipleship-library-manager-new`,
note the spaces) on a machine that has both checked out side by side - worth checking for before
assuming a cross-repo change is out of reach.

## Commands

```bash
# Run (always port 5200, not Angular's default 4200 — some tooling/CORS config assumes this)
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
# server is ALREADY running on port 5200 (`npm run start-local -- --port=5200`);
# playwright.config.ts does not auto-start it.
npm run e2e
npx playwright test e2e/smoke.spec.ts    # single spec

# EMULATOR-BACKED TEST PROGRAM (see the Test program section below)
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

`functions/` still uses ESLint 8 + `.eslintrc`-style config while the ESLint auto-detected from the
repo root is the Angular app's flat `eslint.config.js` — `functions/package.json`'s `lint` script
sets `ESLINT_USE_FLAT_CONFIG=false` via `cross-env` to force legacy-config resolution. If you see
`Invalid option '--ext'`, that's this mismatch resurfacing; the fix is already applied, don't remove
the `cross-env`/`ESLINT_USE_FLAT_CONFIG` bits.

Firebase deploys of `functions/` predeploy-run `functions/`'s own `lint` and `build` (see
`firebase.json`).

## Test program (emulator-backed)

Built 2026-08-19/20. FOUR layers, all runnable locally, none of which can touch
impactdisciplesdev or prod (everything targets the local Emulator Suite under the fake
project id `demo-impact`):

1. **Unit** — Karma/Jasmine in this repo and the web repo (`npm run test` in each; the web
   repo's suite was created by this program), plus `functions/`'s own node:test suite
   (`cd functions && npm test`, runs against compiled `lib/`). House style: hand-constructed
   classes with duck-typed deps, NEVER TestBed/DI (see `permission.service.spec.ts`'s comment;
   the one exception is `purchases.service.spec.ts`, forced by an `inject()` field initializer —
   all-stub providers).
2. **Integration** (`integration/`, `npm run test:integration`, emulator must be up) — the REAL
   Cloud Functions running in the emulator, driven over HTTP/callables + Admin-SDK doc writes:
   registration flow, customer upserts, checkout money path, campaign send engine + tracking,
   library license grants. `integration/helpers/emulator.js` is the harness;
   `integration/dao-semantics.test.js` pins the client-SDK contracts FirebaseDAO depends on.
3. **Rules** (`integration/rules/`, `npm run test:rules`) — firestore.rules over
   @firebase/rules-unit-testing v4 (own `demo-rules` namespace, safe alongside everything else).
4. **Cross-app E2E** (`e2e-cross/`, `npm run e2e:cross`) — Playwright flows spanning the admin
   (:5200), web (:4200), and reader (:4300) apps, each served with its `emulator` build
   configuration (`npm run start-emu` in each repo; `playwright.cross.config.ts` starts/reuses
   them). The old `e2e/` suite remains as a live-dev smoke layer.

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
as part of `npm run emu` — flows that would hit a real vendor (PayPal paid path) fail cleanly at
that boundary, which the money tests assert on.

## Branches

`development` is the default and PR-base branch. `origin/main` no longer exists on GitHub — ignore
any tooling default that assumes it. `master` is production: never merge or push to it without the
user explicitly asking, each time — even a general "push to prod" instruction is not standing
permission to touch `master`.

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
  (`functions/src/utils/security.functions.ts`) verifies a Firebase Auth ID token and confirms the
  caller's email exists in the `admin_users` collection. Every function that moves money or deletes
  data must call it — CORS origin-checking (`restrictedCors`, same file) is a browser-side courtesy
  only, not an auth boundary, since Origin headers are trivially spoofed outside a browser.

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
infrastructure) and is imported by every feature module. This codebase is deliberately
NgModule-based with constructor injection throughout, not standalone components/`inject()` — see the
`prefer-standalone`/`prefer-inject` overrides in `eslint.config.js`; don't convert files one at a
time, that migration is out of scope for incidental changes. (The `*ngIf`/`*ngFor` → `@if`/`@for`
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

Four screens today, all sharing one pattern — a tab shell (`reports-manager.component.ts`) that
reads its tab list from `NAV_CONFIG`'s `'reports-manager'` group and renders one `@if
(selectedTab === '<label>')` block per report (no per-report Angular routes; a new report is a new
`NavLeaf` + a new `@if` block + a declaration in `ReportsManagerModule`, not a new route):

- **Purchase Report** (`purchase-report/`, Reports Manager → Purchases) — over the `purchases`
  collection, filters on Purchase Date and State. No group-by mode - removed 2026-08-15 along with
  Subscriber Report's own (below), per the user: none of these reports aggregate/group any more,
  every row is always one real document.
- **Subscriber Report** (`subscriber-report/`, Reports Manager → Subscribers) — over the `customers`
  collection's `subscribedToNewsletter`/`subscribedToPrayerTeam` flags (see the Firestore collection
  naming note below — subscriber state used to be its own `subscriptions` collection), filters on
  Date Subscribed and Type (newsletter/prayer), both real Firestore queries. Type picks which flag/
  date-field pair to query; with Type off, "either type" means querying both flags and merging
  client-side (same OR-across-two-fields pattern as Purchase Report's State criterion, see above)
  since a customer has no single `type` field any more. Absorbed the old standalone Subscribers
  screen (removed 2026-08-15) rather than leaving it separate
  once a subscriber became just a filtered view of `customers` - Edit a subscriber (row double-click)
  and unsubscribing (a row action) both live here now. No manual "add a subscriber" flow (same reason
  Contacts has none, see contact.model.ts's own comment), no List criterion, no selection/
  checkboxes, no saved-list building - the old screen supported carving subscribers into saved
  sub-lists, but this app doesn't do that (per the user, explicitly): Send Newsletter/Send Prayer
  Request always target every subscriber currently flagged for that type, full stop, no per-send
  audience narrowing.
- **Contact Report** (`contact-report/`, Reports Manager → Contacts; nee Customer Report) — over the `customers`
  collection, State only, no date/list criteria and no group-by mode: `ContactModel` has no
  signup/created-date field at all (customer docs are upserted from purchases/event registrations —
  see `functions/src/customer-upsert.functions.ts` — with no timestamp stamped anywhere), and there
  is no live list-membership mechanism wired to Customers (see the Pagination section above).
- **Event Report** (`event-report/`, Reports Manager → Events) — pick an event (single required
  select, not a checkboxed criteria form like the other 3 — there's only one real "criterion" here,
  so picking one loads its data immediately rather than needing a separate "Generate Report" submit
  step), see its details and attendee list, with a "Live Events Only" checkbox narrowing the picker
  to `isActive` events. A summit event (`isSummit`) adds a toggle between a plain attendee list and a
  breakout-session-grouped report — breakout sign-up isn't its own collection:
  `EventRegistrationModel.trainingSessions` is an array of agenda-item ids, cross-referenced against
  the event's own `agendaItems` for session time AND display name (the item's own `text` since the
  2026-08-19 Courses retirement — the old second hop to the `courses` collection is gone; an item
  with no title renders '(unknown breakout)' instead of silently dropping the student). The join
  originated in the Summit event-edit screen's old "Break Outs" tab
  (`event-breakouts.component.ts`), whose `flatten()`/`buildRows()` were copied here rather than
  reusing the component; that tab and component were then removed outright (2026-08) as redundant
  with this report, which is now the app's only breakout view. The breakout view is a hand-rolled
  collapsible `<table>` (plain `@for`/`@if`, not
  `mat-table`/`DataSource`) — breakout, then (only when a breakout has more than one distinct time)
  a time-slot layer within it, both collapsed by default; a flat mat-table row list fights back
  against collapsing arbitrary subtrees, and a `<td colspan="3">` group-header cell (needed so a
  section's title bar spans every real column, not just the first) isn't expressible through
  mat-table's per-column `matColumnDef` model without the same fight.

Common conventions established by Purchase Report and followed by the others:

- A dedicated `ReportRow` interface distinct from the underlying entity model (e.g. `CheckoutForm`)
  — a report row is a flat, report-specific shape, and in grouped/aggregate mode a synthesized
  aggregate that doesn't correspond to any single real document.
- Criteria drive **real Firestore queries** (`queryAllByMultiValue`/`QueryParam`) wherever the data
  supports it, not a full-collection client-side filter. Where Firestore can't OR across two fields
  in one query (e.g. matching a State against both billing and shipping address), the report queries
  twice and merges/dedupes by id client-side.
- Reuses list-screen infra: `ColumnDef[]` visibility toggles, `DataGridColumn`/`app-data-grid`
  (rendered with `[showHeader]="false" [showFilterRow]="false"` — Columns/Export/criteria stay this
  component's own hand-rolled `app-list-header`, not the grid's built-in versions), `exportToExcel`/
  `ExcelColumn` (`shared/table-export.util.ts`) — same conventions as the List-screen section above.
- Known limitation on Purchase Report specifically, documented inline and in `MIGRATION.md`:
  malformed date fields (see next section) can silently drop matching rows from a date-range report
  query. A "specific product(s)" filter was deliberately dropped as infeasible without a schema
  change (cart items aren't a scalar-array-queryable field) — also documented inline with a pointer
  to `MIGRATION.md`.
- Before adding a criterion that filters/groups by some field, confirm that field is actually
  queryable data on the entity, not something that only exists in a downstream, one-way-synced
  system (see Contact Report's own header comment on why it has no List filter — Mailchimp
  membership is push-only, never mirrored back to Firestore, see Cloud Functions section below).

### `MIGRATION.md`

Repo-root running list of known Firestore data-integrity issues and their defensive fixes — most
notably inconsistent date-field shapes (real `Timestamp` vs. a malformed `{seconds,nanoseconds}` map
vs. an ISO string) that can break sort order or silently exclude documents from range queries; the
defensive fix is the `toMillis()` helper in `src/app/common/utils/date-from-timestamp.ts`. Check it
before writing any new query or sort against a date field, and add to it when you find a new
data-shape gotcha rather than working around it silently in one screen.

### Email Builder (`src/app/tools-manager/email-designer/`)

Full-screen, Mailchimp-style drag-drop email designer, lazy-loaded from tools-manager routing at
`/tools-manager/email-designer/new | :id`. Reached from Tools Manager > Email Templates ("New Email
Design" header action; row edit routes there when the template has a `design`); deliberately has NO
NavLeaf/screenKey of its own — it rides `tools-manager.email-templates` grants (checked in
`EmailDesignerComponent` after the first auth emission — a synchronous check bounced legitimate
direct-URL loads). Quill (the old 800px dialog) remains for "Rich Text" templates; the Editor column
on the list distinguishes them, and **presence of `MailTemplateModel.design` is the editor-type
flag**. Key pieces:

- **Design document**: `EmailDesign` (`src/app/common/models/admin/email-design.model.ts`) —
  sections (header/body/footer) → rows (1–4 columns) → typed blocks (heading/text/image/logo/button/
  divider/spacer/video/social/footer), each with desktop styles + sparse mobile overrides behind a
  `stylesLinked` toggle, plus email-wide `globalStyles` (desktop + mobile Partial). `null` for
  "unset", never `undefined` (see the Firestore write gotcha above; `stripUndefinedDeep()` in
  `src/app/common/utils/strip-undefined.ts` sweeps the save as belt-and-braces).
- **Compiler**: `src/app/common/utils/email/email-design-compiler.ts` — PURE TS (no Angular/DOM),
  design JSON → email-client-safe table HTML (600px, inline styles, MSO ghost tables for columns,
  one `@media` block for column stacking + unlinked mobile diffs). Mirrorable into `functions/` the
  same way `html-to-text.ts` is. On every save, `html` is recompiled from `design` — downstream
  consumers (campaign composer, send paths) only ever read `html` and needed zero changes.
- **Merge tags**: `src/app/common/utils/email/merge-tags.ts` — the ONE substitution engine.
  `*|FNAME|*`-style tags (incl. `*|TAG|fallback|*` inline defaults and `*|UNSUB|*` → caller-supplied
  unsubscribe URL), each absorbing the legacy `{{Recipient First Name}}`/`{{firstName}}` spellings,
  replacing ALL occurrences. The subscriber-blast and event-attendee-email dialogs were refactored
  onto it (their old chained `String.replace()` only hit the first occurrence); `EMailService`'s
  dead client-side template methods were removed at the same time. Functions-side substitution
  (`transactional-emails.ts`, `event-registration.functions.ts`) still uses its own `{{...}}`
  split/join — mirror `merge-tags.ts` into `functions/src/` before pointing a Cloud Function at
  builder-authored templates.
- **Editor internals**: per-instance `DesignerStateService` (commit-with-undo-snapshot mutations,
  cap 50, Ctrl+Z/Y suppressed while a Quill instance is live); CDK drag-drop adapted from the form
  builder's `field-drop.util.ts` (`block-drop.util.ts`); inline text editing is ngx-quill's BUBBLE
  theme (one live instance, swapped in on click-when-selected, output normalized through dompurify
  in `inline-editor/inline-html.util.ts`) — note the `styles.scss` global quill rules are
  deliberately overridden for `.inline-editor` (the global absolute-position layout collapses an
  auto-height editor to nothing). Image/logo/video-thumbnail picking reuses `app-image-uploader`.
  Video = linked thumbnail (YouTube via static `img.youtube.com` URLs, Vimeo via oEmbed —
  `HttpClientModule` is provided in this lazy module because the app has no global HttpClient).
  Preview renders the compiled HTML in a `sandbox="allow-same-origin"` (no scripts) iframe — the
  srcdoc SafeHtml is memoized, a per-CD-cycle getter made the iframe reload in a loop. Send Test
  goes through `EMailService.sendHtmlEmail` (the real `mail`-collection pipeline). E2E:
  `e2e/email-designer.spec.ts`.

### Cloud Functions (`functions/src/`)

Plain Node/Express-style `onRequest` HTTP functions (not callable functions), one file per concern
(`paypal.functions.ts`, `shipping.functions.ts`, `purchase-fulfillment.functions.ts`,
`new-record-alerts.functions.ts` — this replaced `notifications.functions.ts` —
`admin-users.functions.ts`, `subscriptions.functions.ts`, `youtube.functions.ts`,
`customer-upsert.functions.ts`, `event-registration-customer-upsert.functions.ts`,
`mailchimp-sync.functions.ts`), each `require`d and re-exported from `functions/src/index.ts`.
Shared cross-cutting concerns (`restrictedCors`, `requireStaffAuth`) live in
`functions/src/utils/security.functions.ts`.

- **Customer auto-upsert**: `customer-upsert.functions.ts` and
  `event-registration-customer-upsert.functions.ts` keep Customer records created/synced
  automatically from purchase and event-registration writes — Customer data is no longer only
  manually maintained in the admin UI, worth knowing before assuming a Customer doc's fields are
  admin-entered.
- **Mailchimp sync — REMOVED 2026-08-20** (Phase 7): `mailchimp-sync.functions.ts`, the
  `@mailchimp/mailchimp_marketing` dependency, `MailchimpConfigModel/Service`, the
  `campaigns-manager/mailchimp-settings/` screen, the `integration_settings` collection + rules
  block, and the `addMailchimpSourceTag` hooks in the two customer-upsert functions are all gone.
  The audience was reconciled into `customers` first (`scripts/archive/mailchimp-sunset/reconcile-mailchimp-audience.js`;
  MIGRATION.md has the numbers). Nothing in the suite talks to Mailchimp any more — the only
  Mailchimp words left in code are the `*|TAG|*` merge-tag syntax (ours now) and the one-time
  import/backfill scripts.

### Email taxonomy (agreed vocabulary, 2026-08-18)

Every email in the system is one of two kinds, sorted by who presses send:

- **Transactional** — sent automatically by the platform because a customer did something: sales
  receipts, per-product follow-up emails, event-registration confirmations, reader receipts,
  password resets. All functions-side (`transactional-emails.ts`, `event-registration.functions.ts`).
  Admins edit their *content* (several render from `mail_templates` docs — the sales receipt is
  looked up **by the literal name "Sales Receipt"**, the Amazon fulfillment confirmation **by the
  literal name "Amazon Shipping Confirmation"** (PurchasesService.sendAmazonConfirmation), and
  product follow-ups by doc id via `Product.followUpEmailId` — so renaming/deleting those templates
  silently breaks the emails; a known, accepted risk for now, deliberately left unguarded per the
  user 2026-08-18), but never choose their audience or timing.
- **Campaigns** — admin-initiated outreach to contacts: the Campaigns Manager group (one-time and
  automated campaigns, tag rules, Mailchimp audience sync) plus the contextual sends that stay
  where their context is (newsletter/prayer blasts on the Subscribers report, attendee emails on an
  event's Attendees tab). All share the `mail_templates` catalogue + merge-tag engine.

The old web-form→admin notification emails (Lunch and Learn etc.) are a dead category — form
submissions today only feed the bell-badge counters (`new-record-alerts.functions.ts`) and the Form
Submissions screen; the only surviving form-related email is the admin-initiated Route Request
forward. Use this vocabulary in UI copy and code comments rather than inventing new terms.

**Templates vs. history** (2026-08-18): `mail_templates` holds only true, reusable TEMPLATES; what
actually went out is campaign history (below). The designer picker's collapsed **Past Emails**
section and the designer's `?fromEmail=<campaignEmailId>` seed let any past send start a new design.

**Campaign Manager v2** (2026-08-18, Phase 1 built on `feature/campaign-manager-v2` — full design
in the "Campaign Manager v2" plan): a campaign is a promotional EFFORT, not an email.
`CampaignModel` = `goal` ('product'|'event'|'other' + `otherKind`) + `channels` (['email','web']) +
`audience` + rollup `stats` (v2 funnel shape: sent/delivered/opens/uniqueOpens/clicks/uniqueClicks/
purchases/revenue/registrations/subscribes + webShown/webClicks) — the v1 `type` field and the
composer/template-gallery components are GONE (campaign creation returns with the Phase 2 wizard +
send engine; v1's Launch never sent anything anyway). `campaign_emails` docs are email "touches", N
per campaign via `campaignId` (no longer 1:1 same-doc-id), each with label/subject/html snapshot/
sentAt/per-email stats/sendConfig; composite index `campaign_emails(campaignId, sentAt DESC)` backs
the detail timeline. The 477 imported Mailchimp sends were REGROUPED into 78 campaigns (Blog Posts
149 emails, DMP Program 50, Disciple-Making Minute 43, Monthly Newsletter 40, Prayer Letter 30,
Podcast 23, summits by year, per-product/event pushes, singletons) via
`scripts/archive/mailchimp-sunset/propose-campaign-regroup.js` (auto-proposal, user-reviewed) +
`scripts/archive/mailchimp-sunset/apply-campaign-regroup.js` (idempotent, exports a full JSON backup to scripts/output/
first — the undo path). Surfaces: Campaigns list (all campaigns, kind/channel chips, funnel
columns) → in-page **campaign-detail** (funnel tiles + touches timeline, `?campaignId=` deep link),
Status Board (board+calendar lenses, cards deep-link to detail), **Sent Emails** = the global email
log over `campaign_emails`.

**Phase 2 (send engine, 2026-08-18)**: every campaign email sends through ONE server-side path,
`functions/src/campaign-send.functions.ts` — callables `enqueueCampaignEmail` /
`previewCampaignAudience` (same audience resolver as send-time, so previews can't lie) /
`sendCampaignTestEmail`, plus hourly `campaignSendScheduler` (drains queued sends 200/hour,
activates scheduled touches, runs tag-triggered automations — the old auto-campaign behavior is
now a touch's `sendConfig.mode: 'tagTriggered'`; `campaign-auto-send.functions.ts` is deleted).
Per-recipient ledger `campaign_sends/{emailDocId}__{email}` (atomic create = at-most-once per
touch; carries a crypto `token` for Phase 3 tracking + `unsubType`); `queueMail()` takes optional
`campaignMeta` and `onCampaignMailDelivered` (onDocumentUpdated mail/{id}) writes the Trigger
Email extension's SUCCESS state back as delivered counts. Every campaign send gets an unsubscribe
link (template's `*|UNSUB|*` or an appended fallback footer — never doubled). SMTP relay is the
org's OWN server (`mail.impactdisciples.com:26`, verified) — hourly cap unconfirmed with the
host; 200/hour pacing is deliberate. UI: campaign-wizard (goal/audience/window; web channel
visible but disabled until Phase 5) + email-touch-editor (template-snapshot content — editing a
template later never rewrites campaign history; send now / schedule / tag-trigger; send-test).
Composite indexes `campaign_sends(status, createdAt)` + `campaign_sends(emailId, status)`.

**Phase 3 (tracking, 2026-08-18)**: `functions/src/campaign-tracking.functions.ts` — `campaign_open`
(1x1 GIF pixel, `?t=<token>`; opens++ always, uniqueOpens gated by the ledger's `openedAt`) and
`campaign_click` (`?t=&l=`; LINK-MAP redirect — the target comes from the touch's stored
`links {l1: url}`, never the query string, so there is no open-redirect surface; clicks/uniqueClicks,
and a click backfills the unique open for image-blocked clients). The send path builds the link map
lazily at first send (`ensureLinkMap`, covers all three modes), rewrites hrefs per recipient, and
injects the pixel; public-site links get `?cid=<campaignId>&ceid=<emailId>` appended in the map —
Phase 4's attribution capture reads those on landing. Unsubscribe links are NEVER routed through
tracking. Every hit also lands in `campaign_events` (staff-read/write-false). Opens are approximate
(proxy prefetch) — clicks/purchases are the trustworthy stages.
**Phase 4 (attribution, 2026-08-19)**: the funnel's conversion stages are wired end to end.
Web repo (`feature/campaign-attribution`, stacked on feature/paypal-speed): `AttributionService`
(src/app/shared/utils/services/) reads `?cid/&ceid/&csrc` from `window.location.search` in its
constructor — injected by AppComponent at bootstrap, deliberately BEFORE the router's first
navigation (pages rewrite query params on landing) — localStorage, 30-day TTL, last touch wins;
checkout/subscribe/event-registration requests attach it. Admin functions:
`sanitizeAttribution()` / `recordCampaignConversion()` / `campaignForCoupon()` in
campaign-tracking.functions.ts — `create_paypal_order` stamps validated attribution onto the
checkout form (free path credits immediately; paid path stages it on pending_orders and
`capture_paypal_order` credits on capture), `subscribe_to_email_list` credits fresh subscribes,
`register_for_event` credits registrations. Coupon fallback: no explicit attribution but a coupon
matching a LIVE campaign's `couponId` credits `via:'coupon'`. All best-effort — attribution can
never fail an order — and the campaign must exist before anything is credited (client field is
advisory). Purchases carry an `attribution` field now.
**Phase 5 (web popups, 2026-08-19)**: the second channel. `campaign_popups/{campaignId}` (one per
campaign, PUBLIC-readable rules — which is why popups are their own collection; never put audience
or stats on them) + staff-only `popup_templates` recipes (seeded by `scripts/seed-popup-templates.js`
from the retired v1 gallery copy). Admin: popup-editor (recipes, live preview, "save as template?",
date window, click-through URL auto-decorated with `?cid&csrc=popup`) reached from campaign detail's
Add/Edit Popup; saving an active popup adds 'web' to the campaign's channels. Web repo:
`campaign-popup.component` in the app shell shows the first active in-window popup to EVERY visitor
(no targeting, user decision) until they check don't-show-again (per-popup localStorage); fires the
CORS-open `campaign_web_event` beacon (web_shown once per visitor per popup — localStorage-guarded —
and web_click), which validates the campaign is effectively live before counting. A popup click
lands with `?cid&csrc=popup` → AttributionService → purchases credit `via:'popup'`.

**Phase 6 (consolidation, 2026-08-19)**: one send system. The Subscriber Report's newsletter/prayer
dialog and the event Attendees email dialog are now THIN FLOWS over the send engine — each send
creates a campaign (+one touch) and calls `enqueueCampaignEmail`, with a real audience-count
confirm first; the un-awaited client-side per-recipient loops and the write-only
`newsletters`/`prayers`/`customer-emails` archive collections are dead (frozen — the campaign IS
the archive; the public Monthly Newsletter page used to read the UNRELATED `monthly-newsletter`
collection — retired 2026-08-20, see "Public newsletter archive" below). Event-attendee sends use audience `unsubType: 'none'` — OPERATIONAL emails:
no unsubscribe footer and the newsletter opt-out is deliberately not applied (a marketing
unsubscribe must not withhold info about an event someone registered for). The Home Page Popups
screen (web-manager) is retired — the public site never had a renderer for it; its
`home_page_popups` docs are left inert. Phase 7 (Mailchimp sunset) executed 2026-08-20: newsletter
archive off Mailchimp links, images re-hosted, audience reconciled into `customers`, sync removed —
see the three paragraphs below; what's left is closing the account + deleting the
`MAILCHIMP_API_KEY` secrets once the one-time scripts are archived.

**Public newsletter archive (2026-08-20, `feature/newsletter-archive` in admin + web)**: the web
app's Monthly Newsletter page now lists/renders `campaign_emails` touches an admin flagged
`publishToWeb` (+ optional `webTitle`), through ONE public endpoint,
`functions/src/newsletter-archive.functions.ts` → `newsletter_archive` (no `?id` = JSON list of
`{id,title,date}`; `?id=` = the touch's html, merge tags rendered anonymously, Mailchimp-only
`*|...|*` tags stripped, scripts/on* removed, CSP `script-src 'none'`, CORS-open; composite index
`campaign_emails(publishToWeb, sentAt DESC)`). `campaign_emails` itself stays staff-only. The flag
is CURATED PER TOUCH on purpose — the old public list (14 rows, all mailchi.mp links) spanned the
regrouped Monthly Newsletter campaign, the Prayer Letter campaign AND standalone sends, and the
Monthly Newsletter campaign holds promos nobody published; "all touches of campaign X" was never
the rule. Set it from campaign detail's touch row (globe icon → "Show on website" dialog; sent/
sending touches only) or the Subscriber Report send dialog's checkbox. Retired: the Content
Manager's Monthly Newsletters screen/service/model and the `monthly-newsletter` collection + its
rules block (web repo: `NewsletterArchiveService` + `/monthly-newsletter/:id` sandboxed-srcdoc
viewer replace the Firestore read). `scripts/archive/mailchimp-sunset/backfill-newsletter-archive.js` maps legacy rows to
`mc_*` touches via the Mailchimp API's archive_url (dry-run default, `--execute`) — MIGRATION.md
has the prod runbook. Phase 7 note: the archived snapshots' images still live on Mailchimp's CDN
(`mcusercontent.com`); the sunset must keep the account alive or re-host them. **Website
Newsletters** tab (campaigns-manager, `web-newsletters/`): every flagged touch across ALL campaigns
= what the public page shows (live stream, preview / view-on-site / view-campaign / re-title-or-
unpublish) — needed because the published set is spread over several campaigns, so no one campaign
detail page answers "what's on the website?".

**Campaign delete (2026-08-20)**: the `deleteCampaign` callable
(`functions/src/campaign-admin.functions.ts`; `CampaignService.planDelete()` = its dryRun,
`deleteCascade()` = execute). Cascades every `campaign_emails` touch (incl. website-published ones)
and the `campaign_popups/{id}` doc, then the campaign — then (user requirement) deletes from Storage
every image those docs referenced that NOTHING else still references: every content-bearing
collection in the default DB is scanned once (`SCAN_DENYLIST` skips the big no-image ones; unknown
collections are scanned by default), so shared assets (re-hosted Mailchimp images used by many
emails, product photos reused in a promo) survive by construction. NOT removed:
`campaign_sends`/`campaign_events` (function-owned audit; the send engine tolerates a missing touch)
and `tag_applications` (customer facts). REFUSED while any touch is sending/scheduled. Caveat
inherent to "delete unused images": already-delivered copies of that campaign's emails lose those
images. Surfaces: list row trash icon and the detail header DELETE button, both behind
`canDelete('campaigns-manager.campaigns')`; confirm copy + result snackbar in
`campaigns/campaign-delete-text.ts` (shows the image-candidate count / unused-removed count).

**Mailchimp image re-host (2026-08-20, Phase 7 step)**: `scripts/archive/mailchimp-sunset/rehost-mailchimp-images.js` moved
every Mailchimp-CDN image referenced by `campaign_emails` + `mail_templates` (623 distinct files)
to `email-assets/mailchimp/<sha1>.<ext>` in the shared bucket and rewrote the docs in dev AND prod
(map in `scripts/output/rehost-map.json`, gitignored). Zero Mailchimp-host references remain in
either env — the public archive and Past Emails previews no longer depend on the Mailchimp account.
(A handful of snapshots also embed images from an unrelated external bucket,
`sawa-dev-2-storage-bucket.storage.googleapis.com` — not Mailchimp, left alone.)

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
full picture; both repos' `common/` are independent copies (no longer a shared submodule), so this
kind of fix never propagates automatically and has to be made in each repo.
