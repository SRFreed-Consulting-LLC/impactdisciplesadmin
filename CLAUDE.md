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
- `appInfiniteScroll` directive + `<app-paged-table-footer>` (`src/app/shared/`) — scroll-triggered
  "load more" plus a "N loaded" footer indicator.
- Firestore's `orderBy()` silently excludes any doc missing that field — if you add pagination to a
  new table, confirm every existing record actually has the `orderByField` set.
- **Customers is a special case**: the grid is paginated, but a separate one-time full `getAll()`
  (`allCustomers`) backs "Filter by List"/"Save List" — paginating that too would risk silently
  truncating a saved list to whatever page happened to be scrolled into view. Read the comment in
  `customers.component.ts` before changing this.
- New tables should follow this pattern (see `products.component.ts` for the fullest example) rather
  than reintroducing whole-collection `streamAll()`.

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
- `AuthGuardService` (same file) gates every route. **It must check Firebase Auth's own session
  state (`currentUser$` + a live `getIdTokenResult()` check), never the cookie** — the cookie is
  forgeable from devtools and is not treated as proof of authentication. See the `SECURITY` comment
  on `canActivate()` before touching this.
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
each gated by `AuthGuardService`: `admin-manager` (Admin Users, Customers, Log Messages),
`events-manager`, `requests-manager`, `subscriptions-manager`, `web-manager`, `store-manager`
(Products, Purchases, ...). `src/app/core/main-screen/` is the shell (top bar + nav) wrapping the
`dashboard` home route and all feature module outlets. `src/app/shared/` holds cross-feature
UI (list header, column filter, dialogs, image uploader, table export/loading, paged-table
infrastructure) and is imported by every feature module. This codebase is deliberately
NgModule-based with constructor injection throughout, not standalone components/`inject()` — see the
`prefer-standalone`/`prefer-inject` overrides in `eslint.config.js`; don't convert files one at a
time, that migration (like `*ngIf`/`*ngFor` → `@if`/`@for`) is out of scope for incidental changes.

### Cloud Functions (`functions/src/`)

Plain Node/Express-style `onRequest` HTTP functions (not callable functions), one file per concern
(`stripe.functions.ts`, `shipping.functions.ts`, `notifications.functions.ts`,
`admin-users.functions.ts`, `subscriptions.functions.ts`, `youtube.functions.ts`,
`import.functions.ts`, `fetchimage.functions.ts`), each `require`d and re-exported from
`functions/src/index.ts`. Shared cross-cutting concerns (`restrictedCors`, `requireStaffAuth`) live
in `functions/src/utils/security.functions.ts`.

### Firestore collection naming note

The Admin Users collection is `admin_users` (renamed from `users`; see commit `3ffcbd4`) — both the
Angular `AdminUserService` and the Cloud Functions' `requireStaffAuth()` were updated together. The
old `users` collection is still present in Firestore but intentionally unused/orphaned pending
verification — don't resurrect it as a source of truth.
