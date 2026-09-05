# Cloud Functions

> Split out of the admin repo's CLAUDE.md on 2026-08-26 to keep the
> always-loaded file small. This file is picked up when working inside `functions/`.

## HARD 80-COLUMN LIMIT — write to it, don't discover it

**Every line in `functions/` must be ≤ 80 characters.** `eslint`'s `max-len`
enforces it as an ERROR, and `firebase deploy` runs lint as a predeploy hook,
so an over-length line **blocks the deploy**.

This trips people (and agents) constantly because the two halves of this repo
disagree and nothing warns you at the moment you type:

| | limit | enforced by |
|---|---|---|
| the Angular app (`src/`) | **120** | prettier, `printWidth: 120` in `.prettierrc.json` |
| `functions/` | **80** | eslint `max-len` — **there is no prettier here** |

So code that is perfectly formatted in `src/` fails lint the moment it is
written in `functions/`. There is no formatter to rescue you: `max-len` is
NOT auto-fixable, `eslint --fix` will not touch it, and `npm run format` does
not cover this project.

Two practical rules:

- **Run `npm run lint` in `functions/` BEFORE deploying, always.** During a
  deploy the failure surfaces as
  `spawn npm --prefix "%RESOURCE_DIR%" run lint ENOENT`, which masks the real
  error - the actual `max-len` line is printed ABOVE it.
- **When a line is too long, SHORTEN it - do not reflexively wrap it.**
  Wrapping a `test("...", () => {` or a call's arguments changes the expected
  indentation of everything inside, and the Google style rules then error on
  every one of those lines. That has already happened here: one fix traded 6
  `max-len` errors for 20 `indent` errors. Prefer a shorter identifier, a
  shorter string, or hoisting a value to a `const`.

### Cloud Functions (`functions/src/`)

Plain Node/Express-style `onRequest` HTTP functions (not callable functions), one file per concern
(`paypal.functions.ts`, `shipping.functions.ts`, `purchase-fulfillment.functions.ts`,
`new-record-alerts.functions.ts` — this replaced `notifications.functions.ts` —
`admin-users.functions.ts`, `subscriptions.functions.ts`, `youtube.functions.ts`,
`customer-upsert.functions.ts`, `event-registration-customer-upsert.functions.ts`, the
`library-*.functions.ts` family behind the reader app, the `campaign-*.functions.ts` send/tracking/
admin engine), each `require`d and re-exported from `functions/src/index.ts` - and `index.ts` must
export exactly the names in the shared contract (`functions/test/contract.test.js` enforces it).
Shared cross-cutting concerns (`restrictedCors`, `requireStaffAuth`) live in
`functions/src/utils/security.functions.ts`.

**Shared helpers you should reach for before writing the read yourself (2026-09-05, review item 4):**

- `utils/public-http.ts` — `publicHttp(name, {method, ...options}, handler)` is an anonymous,
  browser-called endpoint: onRequest + the CORS allow-list + one verb + a catch-all 500. Eight
  endpoints use it (the five event-registration ones, `lookup_coupon`, subscribe, unsubscribe).
  Its catch is not decoration: `restrictedCors` cannot await the handler, so a throw from an
  un-caught async handler used to be an unhandled rejection with nothing sent and the request
  hanging to timeout. The PayPal, shipping and YouTube endpoints keep `restrictedCors` directly —
  they map failures to their own error codes or gate on `requireStaffAuth`.
- `utils/secrets.ts` — every `defineSecret()` param, declared once. Bind with
  `{secrets: [X]}`, read with `X.value()` inside the handler. No more `secrets: ["NAME"]` +
  `process.env.NAME ?? ""`: a typo or an unbound secret used to yield `""` and fail somewhere
  downstream; `.value()` throws at the read, naming the secret. A new secret must also be added
  to `scripts/write-emulator-env.js`'s SECRETS list or every function fails to load locally.
- `utils/tenant-config.ts` — `readTenantConfig(db)` is the one way to read the `config`
  singleton. It refuses (throws) when there are two documents rather than picking one at random.
- `utils/coupons.ts` — `findActiveCoupon(db, code)` is the read + `pickActiveCoupon`; the four
  money paths and `lookup_coupon` all resolve a code through it, so what the cart says "applied"
  is what checkout charges.
- `utils/library-books.ts` — `knownBookIds` / `findBookDoc` / `bookTitlesById`, over ONE
  `collectionGroup("books")` read that lives only there. When a second tenant exists, that is the
  single function to scope.
- `utils/unsubscribe-token.ts` + `transactional-emails.unsubscribeUrlFor()` — every unsubscribe
  link is signed (HMAC of address + list under `UNSUBSCRIBE_TOKEN_SECRET`); the endpoint verifies
  it, and honours untokened links only until `LEGACY_UNSUBSCRIBE_LINKS_UNTIL` (2026-10-06). Any
  function that builds a link must bind that secret.
- `utils/rate-limit.ts` — `RateLimiter` (per-instance sliding window) + `clientIp`; `lookup_coupon`
  allows 30 tries a minute per address and runs with `maxInstances: 2`, because a free
  "is X a code" endpoint is a dictionary oracle otherwise.

- **Shared contract + config (2026-08-20, Stage 2e of the refactor sweep)**: the suite-wide
  function-name contract and Firebase project config live in the shared submodule
  (`src/common/src/shared/contract/functions-contract.ts`, `.../config/firebase-projects.ts`).
  `functions/scripts/sync-shared.js` copies the SDK-free slices (`config/`, `contract/`, `lists/`)
  into `functions/src/shared/` on every `npm run build` (the `prebuild` script; gitignored,
  lint-ignored - never edit it there). `restrictedCors` reads `CORS_ALLOWED_ORIGINS` from it, and
  `functions/test/contract.test.js` fails the build when `index.ts` exports don't match the
  contract exactly - so adding/renaming/removing a function means: edit the contract in the
  submodule first, then index.ts, then the client apps (web env URLs, reader/admin
  `httpsCallable` names) all read the new name from the same place.

- **Public Impact Group finder** (`library-groups-public.functions.ts`, 2026-08-23):
  `search_impact_groups` is the ONLY anonymous read path onto `discussionGroups`. Every group read
  in `firestore.rules` is behind `signedIn()` and the public web site has no Firebase Auth at all,
  so the finder cannot query Firestore — this reads with the Admin SDK and returns a narrow
  projection instead. `toPublicSummary()` is the security boundary and is pinned by tests: it must
  never emit `onlineInfo` (free text that in practice holds meeting links and passwords), member
  data, `creatorEmail`, an address whose `addressVisible` is false, or the legacy
  `inPersonLocation` free text. Leader identity is reduced to "Matthew F.". Closed and
  invite-only groups are excluded — note the reader only filters invite-only client-side, so this
  is the first place it is a real boundary.
- **Group deletion cleanup** (`library-group-cleanup.functions.ts`, 2026-08-23):
  `onGroupDeletedCleanup` handles the top-level collections that reference a group by FIELD rather
  than living under it. The admin app's `deleteGroup` cascade only ever walked the subcollections,
  so `groupInvites` and `groupLicenses` were left stranded. It is a TRIGGER rather than part of
  that cascade for two reasons: `firestore.rules` blocks all client writes to `groupInvites`
  (`allow write: if false`), so the admin app physically cannot do it, and a trigger covers every
  delete path instead of one screen. It deletes PENDING invites (the doc id is the bearer token in
  the emailed link) and FLAGS assigned licenses `assignedGroupDeleted` — it deliberately does not
  auto-revoke, because revoking strips the book from the recipient and staff deleting a group is
  not the recipient's doing. `revokeGroupLicense` reads that flag path: a DELETED group is now a
  separate branch from a CLOSED one, so a leader can reclaim a unit that moderation would
  otherwise have burned permanently.
- **Customer auto-upsert**: `customer-upsert.functions.ts` and
  `event-registration-customer-upsert.functions.ts` keep Customer records created/synced
  automatically from purchase and event-registration writes — Customer data is no longer only
  manually maintained in the admin UI, worth knowing before assuming a Customer doc's fields are
  admin-entered.
- **Mailchimp sync — REMOVED 2026-08-20** (Phase 7): `mailchimp-sync.functions.ts`, the
  `@mailchimp/mailchimp_marketing` dependency, `MailchimpConfigModel/Service`, the
  `campaigns-manager/mailchimp-settings/` screen, the `integration_settings` collection + rules
  block, and the `addMailchimpSourceTag` hooks in the two customer-upsert functions are all gone.
  The audience was reconciled into `customers` first (`reconcile-mailchimp-audience.js` (removed 2026-08-21; in git history);
  MIGRATION.md has the numbers). Nothing in the suite talks to Mailchimp any more — the only
  Mailchimp words left in code are the `*|TAG|*` merge-tag syntax (ours now) and the one-time
  import/backfill scripts.
