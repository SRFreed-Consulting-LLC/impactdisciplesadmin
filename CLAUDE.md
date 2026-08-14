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
patterns (e.g. the login screen). They are not in this repo.

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

# Unit tests (Karma/Jasmine) — no npm script defined, use the Angular CLI directly
ng test                                  # all specs
ng test --include='**/products.component.spec.ts'   # single spec

# E2E (Playwright) — assumes the dev server is ALREADY running on port 5200
# (`npm run start-local -- --port=5200`); playwright.config.ts does not auto-start it.
npm run e2e
npx playwright test e2e/smoke.spec.ts    # single spec
```

Note: `playwright.config.ts`'s `use.baseURL` is still `http://localhost:4200`, left over from before
the port-5200 rule below existed — start the dev server on 5200 per that rule regardless, and if e2e
runs are actually failing against the wrong port, that stale `baseURL` is why.

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

## Firebase projects

- `impactdisciplesdev` — dev, hosting target `development`, site `impactdisciplesdev-admin`.
- `impactdisciples-a82a8` — prod, hosting target `production`, site `impactdisciples-admin`.

Config selection is via Angular build configurations (`local`/`development`/`production`), each
swapping in `src/environments/environment-{local,development,production}.ts` — these hold the
Firestore config, Stripe keys, and Cloud Function URLs for that environment; `environment.local.ts`
points at the `impactdisciplesdev` Firebase project (there's no separate local emulator setup).

`firestore.rules` is currently wide open (`allow read, write: if true`) — a known, unresolved gap,
not a decision to defend or extend.

## Architecture

### Data access: DAO → Service → Component, one pattern for every collection

- **`FirebaseDAO<T>`** (`src/app/common/dao/firebase.dao.ts`) — generic wrapper around
  `@angular/fire/firestore` giving every model type `getAll`/`getById`/`add`/`update`/`delete`,
  `getAllByValue`/`queryByValue`/`queryAllByMultiValue`, live `streamAll`/`streamByValue`/`streamById`,
  and paged one-time `getPage()` (cursor-based via `startAfter`, not offset). All live `stream*`
  methods retry with jitter and swallow terminal errors into `of([])` — see the comment on
  `retryDelay()` for why (a diagnosed WebChannel handshake race when several `onSnapshot` listeners
  attach in the same tick, not a real rules rejection).
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
  wrapper around the DAO; every entity service (`ProductService`, `CustomerService`, etc.) extends
  this and just sets `table` (the Firestore collection name) and optionally `fromFirestore`
  (a deserialization hook).
- Feature components inject their entity service directly and call `streamAll()` for small/live
  reference data (categories, series, tags) or the paginated path (see below) for large collections.

### Pagination (Products, Customers, Log Messages today)

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
  `allCustomers`). List-membership filtering still exists, just on the **Subscribers** screen
  (`customers-manager/subscriptions/`), via a separately-saved `EmailList` doc's `list` array, not a
  Firestore query — see Reports Manager's Subscriber Report below for the same mechanism reused.

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
from the user-menu dropdown, not the left nav), `events-manager`, `customers-manager`,
`web-manager`, `store-manager`, `tools-manager`, `reports-manager`. There is no
`subscriptions-manager` module any more — it was absorbed into `customers-manager` (subscriber
records live at `src/app/customers-manager/subscriptions/`), and there is no `requests-manager`
module either — its one surviving screen, Custom Form Submissions, has moved twice (originally its
own module, briefly under `web-manager`) and now lives under `customers-manager`
(`custom-form-submissions/`) as of the August 2026 nav reorg; the other four Requests Manager
screens (Consultation Requests/Surveys, Lunch and Learn, Seminar) were removed outright, superseded
by the generic Form Builder (`tools-manager`) + Custom Form Submissions pair. `customers-manager`
also owns Purchases/Fulfillment, not `store-manager` — `store-manager` today is Products, Coupons,
Sales, affiliate-sales/affiliate-payments, product-categories, product-series. `tools-manager` holds
Web Config, Email Templates, Shipping Labels, Form Builder, and Mailchimp Settings. `reports-manager`
is new — see below. `src/app/core/main-screen/` is the shell (top bar + nav) wrapping the
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
  collection, filters on Purchase Date and State, group-by-user aggregation.
- **Subscriber Report** (`subscriber-report/`, Reports Manager → Subscribers) — over the
  `subscriptions` collection, filters on Date Subscribed and Type (newsletter/prayer), both real
  Firestore queries, with a group-by-type aggregation (counts + earliest/latest date per type). No
  List criterion — considered (the same saved-`EmailList`-membership mechanism as the Subscribers
  screen's own "Filter by List", client-side rather than a Firestore query since subscribers don't
  carry list membership themselves) and deliberately dropped as not worth the extra criterion.
- **Customer Report** (`customer-report/`, Reports Manager → Customers) — over the `customers`
  collection, State only, no date/list criteria and no group-by mode: `CustomerModel` has no
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
  the event's own `agendaItems` (for session time) and the `courses` collection (for the display
  name). This join is reproduced from `event-breakouts.component.ts`'s own `flatten()`/`buildRows()`
  rather than reusing that component directly — it's tightly coupled to being an `@Input`-driven tab
  inside the event-edit screen, with its own live-stream/filter-row state a one-shot report doesn't
  need. The breakout view is a hand-rolled collapsible `<table>` (plain `@for`/`@if`, not
  `mat-table`/`DataSource`) — breakout, then (only when a breakout has more than one distinct time)
  a time-slot layer within it, both collapsed by default; a flat mat-table row list fights back
  against collapsing arbitrary subtrees, and a `<td colspan="3">` group-header cell (needed so a
  section's title bar spans every real column, not just the first) isn't expressible through
  mat-table's per-column `matColumnDef` model without the same fight.

Common conventions established by Purchase Report and followed by the other two:

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
  system (see Customer Report's own header comment on why it has no List filter — Mailchimp
  membership is push-only, never mirrored back to Firestore, see Cloud Functions section below).

### `MIGRATION.md`

Repo-root running list of known Firestore data-integrity issues and their defensive fixes — most
notably inconsistent date-field shapes (real `Timestamp` vs. a malformed `{seconds,nanoseconds}` map
vs. an ISO string) that can break sort order or silently exclude documents from range queries; the
defensive fix is the `toMillis()` helper in `src/app/common/utils/date-from-timestamp.ts`. Check it
before writing any new query or sort against a date field, and add to it when you find a new
data-shape gotcha rather than working around it silently in one screen.

### Cloud Functions (`functions/src/`)

Plain Node/Express-style `onRequest` HTTP functions (not callable functions), one file per concern
(`stripe.functions.ts`, `paypal.functions.ts`, `shipping.functions.ts`, `purchase-fulfillment.functions.ts`,
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
- **Mailchimp sync**: `mailchimp-sync.functions.ts` (`@mailchimp/mailchimp_marketing`) plus
  `src/app/common/models/utils/mailchimp-config.model.ts`,
  `src/app/common/services/data/mailchimp-config.service.ts`, and the
  `tools-manager/mailchimp-settings/` screen — pushes customer changes to a connected Mailchimp
  audience.

### Firestore collection naming note

The Admin Users collection is `admin_users` (renamed from `users`; see commit `3ffcbd4`) — both the
Angular `AdminUserService` and the Cloud Functions' `requireStaffAuth()` were updated together. The
old `users` collection is still present in Firestore but intentionally unused/orphaned pending
verification — don't resurrect it as a source of truth.
