# Session Handoff — 2026-08-09 (v3, supersedes both earlier versions)

Repo: `impactdisciples - admin` (branch `migrate-from-devexpress`, Angular 20
+ Firebase/Firestore). Read CLAUDE.md first for architecture/commands. This
doc is the state of play for a fresh session.

## Headline: the long-standing refresh bug is RESOLVED (root-caused + verified)

**Symptom (history)**: hard refresh into `/store-manager` produced bursts of
`FirebaseError: Missing or insufficient permissions` and empty lists
(Fulfillment showing "Nothing waiting", Products empty), while SPA
navigation worked. Chased across two sessions through nine rounds of
plausible-but-insufficient fixes (retries, shareReplay fixes, injection
context, forced long-polling — all documented in git history).

**Actual root cause** (found via Playwright network capture — the failing
Listen channels all carried `database=...%2Fimpactdiscipleship-books`):
`BookService` did `dao.fs = getFirestore(app, "impactdiscipleship-books")`
on its **injected** DAO. `FirebaseDAO` is `providedIn: 'root'` and Angular
DI does NOT create separate instances per generic type parameter — so that
mutated the one shared singleton DAO and silently repointed the ENTIRE app
at the sibling library-manager app's named Firestore database the moment
`BookService` was first constructed (i.e. the first time ProductsComponent
rendered — which on a hard refresh happens transiently even when deep-
linking to another tab, because StoreManagerComponent defaults to Products
until the async `loggedInUser$` lookup resolves; on SPA nav the cached user
resolves synchronously and Products never renders, which is why SPA nav
never broke). Reads against the books DB hit *its* restrictive rules (real
permission denials) or returned "successfully" empty for collections that
only exist in `(default)`.

**Fix** (committed): `BookService` now constructs its own private
`FirebaseDAO` for the books database; the shared singleton is never touched.
See the long comment in `src/app/common/services/data/book.service.ts`.

**Verified**: Playwright repro script (login → fulfillment → 3 hard
reloads) went from "0 cards + permission storm every time" to "4 order
cards, zero Firestore errors, all traffic on `(default)`, every reload".
Script kept at
`C:\Users\Owner\AppData\Local\Temp\claude\c--web-repo-impactdisciples---admin\a1f0c4bd-d3ad-477c-9fe4-59983e9d8b68\scratchpad\diagnose-firestore.js`
(session-scoped scratchpad — may be gone; it's ~90 lines, easy to recreate:
capture `firestore.googleapis.com` responses + `requestfailed`, log
`.order-card` / `.empty-state` / `.error-state` counts).

**Lesson recorded for future work**: never mutate the injected
`FirebaseDAO`'s state per-service — it's one shared object app-wide. If a
service needs a different database, give it its own DAO instance the way
`BookService` now does.

## Environment basics
- Dev server: **always port 5200** (`npm run start-local -- --port=5200`).
- Firebase projects: dev = `impactdisciplesdev`, prod = `impactdisciples-a82a8`.
  **Everything this session was dev-only.**
- This project has TWO Firestore databases: `(default)` (this app's data)
  and `impactdiscipleship-books` (the library-manager app's; only
  `BookService` may touch it).
- Deployed `(default)` rules are allow-all (`if request != null`, deployed
  2024-10; verified via firebaserules API 2026-08-09) — they do NOT match
  the repo's `firestore.rules` (`if true`) but are functionally identical.
  Locking these down is a known open security item (see below).
- Admin test login: in the project's Claude memory
  (`admin-login-credentials.md`).
- Live testing: the user's earlier "don't test, I will" rule was lifted for
  the bug hunt ("use playwright to see for yourself if needed") — for new
  feature work, still default to build+lint and let Shane verify visually
  unless he asks.
- Admin SDK one-off scripts against dev work via ADC:
  `cd functions && node -e "...credential.applicationDefault(), projectId:'impactdisciplesdev'..."`.
- Functions runtime is **Node 20, deprecated 2026-04-30, decommissioned
  2026-10-30** (deploy output warns). Upgrade before late October 2026.

## What this session shipped (all committed on `migrate-from-devexpress`)

1. **Purchase Fulfillment workflow** (Store Manager > Fulfillment): 5-step
   status flow on purchases with a physical item — `new` (auto, Firestore
   trigger `onPurchaseFulfillmentEligible`, **deployed to dev**) →
   `received` (Acknowledge Order) → `shipping_label_printed` (auto on label
   print) → `awaiting_shipping` (Mark as Packaged) → `closed` (Mark as
   Shipped); `received → closed` direct jump for pickup/hand-delivery.
   Physical = cart item with `!isEBook && !isDigitalBook && !isEvent`
   (isEvent exclusion explicitly confirmed by Shane — "we may come up with
   another workflow for events"). Closed orders leave the view. `new`
   orders: red NEW badge + sorted to top. 4 real dev purchases were
   backfilled to `'new'` for testing (the trigger isn't retroactive).
2. **Firestore reliability hardening**: jittered retry on one-time reads
   (`retryGetDocs`, wrapped in `runInInjectionContext`), retry count/curve
   widened (`FIRESTORE_RETRY_COUNT = 6`), `loggedInUser$` rebuilt (shared
   `currentUser$` via `shareReplay(1)` so retries can't churn
   `onAuthStateChanged`; `share({resetOnError})` instead of error-caching
   `shareReplay`), Products' 5 reference streams → one-time `getAll()`,
   `streamAll()` grew an optional `onError` side-channel + Fulfillment
   shows an honest "couldn't load / Retry" banner instead of a lying empty
   state. All kept even though the root cause turned out to be BookService —
   they're sound defensive fixes.
3. **Injection-context cleanup**: `provideAuth`/`provideFunctions` in
   `app.module.ts`; `FireAuthDao`, `AdminUserService`,
   `NotificationDialogComponent` inject `Auth`/`Functions` instead of raw
   `getAuth()`/`getFunctions()`.
4. **Login screen**: reactive-forms `[disabled]`-binding warning fixed via
   `form.disable()/.enable()`.
5. **Nav polish** (final rounds): row heights/fonts, `$selected: #337ab7`
   active color distinct from hover yellow.

Baselines: Angular lint has **194 pre-existing errors** (unchanged all
session — that number IS the clean state); functions lint has 1 pre-existing
warning. `ng build` clean.

## Open items (none started, in rough priority order)
- **Security findings list** (presented to Shane, none fixed; he wants to
  go through them one at a time eventually):
  - CRITICAL: `functions/src/import.functions.ts` — fully open
    unauthenticated Firestore write endpoint.
  - CRITICAL: Firestore rules effectively allow-all (see above) — the
    long-designed rules redesign was never resumed.
  - HIGH: `functions/src/fetchimage.functions.ts` — unauthenticated + SSRF.
  - HIGH: `get_youtube_keys` leaks real API secrets.
  - MEDIUM: `cancel_payment_intent` missing `requireStaffAuth`; no Storage
    rules file in repo.
  - LOW: unused `SafeHtmlPipe` (dead code today).
- **Node 20 functions runtime upgrade** (hard deadline ~2026-10-30).
- **Delete the orphaned `users` Firestore collection** (renamed to
  `admin_users`; old one intentionally left pending Shane's verification).
- **Prod deploys**: all of this session's function deploys
  (`onPurchaseFulfillmentEligible`, the 12 new-record-alert triggers) and
  data conventions exist in dev only; prod rollout is a deliberate separate
  step Shane hasn't asked for yet.
- **firebase-functions SDK** is 5.0.1; deploy warns it's outdated.
- **Some `purchases` documents store `dateProcessed` as a plain
  `{seconds, nanoseconds}` map, not a real Firestore `Timestamp`** (no
  `.toDate()`, and `orderBy()` sorts a map field by comparing its keys
  alphabetically - `nanoseconds` before `seconds` - not chronologically,
  which is what originally made `orderBy('dateProcessed')` come back
  scrambled). Whatever writes these documents (the storefront,
  `impactdisciples-web` - a separate repo, out of reach from here) is
  sometimes serializing a Timestamp incorrectly before writing. This app
  can only defend against it on read, not fix it at the source - see
  `toMillis()`/`dateFromTimestamp()` (`date-from-timestamp.ts`), the
  canonical helper for coercing any of {real Timestamp, that malformed
  map shape, Date, date string} into a sortable number. Worth flagging to
  whoever owns the storefront repo.
