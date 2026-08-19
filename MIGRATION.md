# Migration thoughts

Running list of things found while working in this repo that are worth
addressing as part of (or before) a real data migration / cleanup pass -
not urgent bugs, not blocking day-to-day work, but the kind of thing that
should get fixed at the source rather than defended against forever at
every call site.

---

## Date fields: inconsistent storage shapes across collections

**Found**: 2026-08-10, while investigating a sort-order bug on
`purchases.dateProcessed`.

Firestore date fields in this app show up in at least **three different
runtime shapes**, depending on which system wrote the document and when:

1. A real Firestore `Timestamp` (has `.seconds`/`.nanoseconds`/`.toDate()`)
   - the correct shape.
2. A **malformed plain map** `{seconds, nanoseconds}` with no `.toDate()` -
   looks like a Timestamp to the eye, isn't one to Firestore. Confirmed live
   in dev (`impactdisciplesdev`): **34 of 391** `purchases.dateProcessed`
   values (~9%) are this shape. `orderBy()` on a field like this sorts by
   comparing map keys alphabetically ("nanoseconds" before "seconds"), not
   chronologically - this is what caused a real, live sort-order bug in the
   admin app's Fulfillment/Purchases screens.
3. A **plain string**, usually ISO-ish (`"2026-01-30T02:00:00"`) - confirmed
   live: **9 of 10** sampled `events.startDate` values are this shape (only
   1 of 10 was a real Timestamp).

All three shapes can appear **within the same collection** (`events` had
both strings and one real Timestamp in a 10-doc sample), so this isn't "one
collection did it wrong" - it's inconsistent per-document, likely from
different code paths/versions of whatever wrote them over time.

**Live sample counts** (`impactdisciplesdev`, 2026-08-10):

| Collection.field | Sample size | real Timestamp | malformed map | string | missing |
|---|---|---|---|---|---|
| `log-messages.date` | 130 | 130 | 0 | 0 | 0 |
| `purchases.dateProcessed` | 391 | 357 | 34 | 0 | 0 |
| `events.startDate` | 10 | 1 | 0 | 9 | 0 |
| `consultation_surveys.date` | 1 | 1 | 0 | 0 | 0 |
| `seminars.date` | 1 | 0 | 0 | 0 | 1 |
| `event-registrations.registrationDate` | 1 | 1 | 0 | 0 | 0 |
| `consultation_requests.date` | 0 | - | - | - | - |
| `lunch_and_learns.date` | 0 | - | - | - | - |

(`consultation_requests`/`lunch_and_learns` have zero documents in dev right
now, so their real-world shape is unverified - worth re-sampling once there's
real data, or checking prod directly if that's ever appropriate.)

**Where this actually bites**:
- Any **client-side sort/filter** (the vast majority of usages in this app)
  is now defended - see "Fix applied" below.
- Any **server-side Firestore `orderBy()`** on one of these fields would
  still be silently wrong for the malformed-map shape specifically (shape
  #2 above) - `orderBy()` can't be patched client-side the way a JS sort
  can. Audited 2026-08-10: the only screen doing this today is Log
  Messages (`getPage(..., 'date', 'desc')`), and its `date` field sampled
  100% real Timestamps - not currently affected, but would silently break
  again if a bad write ever lands there.

**Fix applied in this app** (defensive, not a data fix): `toMillis()`
(`src/app/common/utils/date-from-timestamp.ts`) is now the one canonical
helper for "give me a sortable number from whatever this field turns out to
be" - handles all three shapes above plus a genuine JS `Date`. Every
component that used to hand-roll its own (inconsistent, some silently
broken) version of this now imports it. This makes the *app* resilient
regardless of which shape a given document happens to have - it does not
fix the underlying data.

**What a real fix would look like** (not done, needs a decision + a
migration script, out of scope for incidental work):
1. A one-time Firestore migration script (Admin SDK) that walks every
   collection with a date-shaped field, detects shape #2 or #3, and
   rewrites it as a real `Timestamp` (`admin.firestore.Timestamp.fromDate(...)`).
   Should run against `impactdisciplesdev` first, verified, then `impactdisciples-a82a8` (prod) -
   never done blind against prod.
2. Find and fix whatever's *currently writing* shape #2/#3 - almost
   certainly the storefront (`impactdisciples-web`, a separate repo this
   session can't touch) for the `purchases`/`events` cases specifically.
   Worth flagging to whoever owns that repo; otherwise the migration script
   above just needs to run again periodically as new bad data accumulates.
3. Separately, `dateFromTimestamp()`'s own string-parsing path
   (`parseStringDate()`, same file) has a real bug independent of the above -
   its "is this MM/dd/yyyy" check (`/dd\/dd\/dddd/`) is a regex that can
   never match anything (literal lowercase `d` characters, not digit
   patterns), so it always falls through and returns the **raw, unparsed
   string** for any string input. `toMillis()` now works around this with
   its own `new Date(item)` fallback, but `dateFromTimestamp()` itself -
   used directly by several services' `fromFirestore` hooks for *display*,
   not just sorting - still hands back an unparsed string in that case
   rather than a real `Date`. Not changed in this pass (matches an earlier
   in-session decision to guard locally rather than touch a helper a dozen
   other call sites depend on) - worth fixing at the source once someone's
   ready to verify all its callers.

---

## Requests Manager → Custom Form Submissions data migration

**Done**: 2026-08-11, dev only (`impactdisciplesdev`). Production
(`impactdisciples-a82a8`) still needs this - see "Outstanding for
production" below.

Runbook for migrating the 4 legacy Requests Manager collections
(`consultation_requests`, `consultation_surveys`, `lunch_and_learns`,
`seminars`) into `form_submissions` (the collection behind Web Manager >
Custom Form Submissions), and safely retiring the old collections once
they're no longer being written to.

### Why this exists

Requests Manager (Consultation Requests/Surveys, Lunch and Learn, Seminar)
was removed from the admin app in favor of the generic Form Builder +
Custom Form Submissions pair - see CLAUDE.md's "Feature areas" section.
`impactdisciples-web`'s public pages were rewired one-by-one from hardcoded
dx-forms onto `<app-dynamic-form [formId]="...">`, which submits into
`form_submissions` instead of the old per-request-type collections. Once a
form is cut over, its old collection stops receiving new writes but its
**historical** records are still sitting there in the old shape and need to
be brought forward before the old collection can be deleted.

### Prerequisite: confirm the environment is actually cut over

**Do not migrate+delete a collection that's still being written to.**
Before touching anything, confirm for that environment:

1. The public site's pages for all 4 form types are on
   `<app-dynamic-form>`, not the old dx-form/hardcoded reactive form -
   check `impactdisciples-web`'s `src/app/core/pages/{consultation-survey,
   lunch-and-learn,seminars,contact}/**` for `app-dynamic-form` usage, and
   confirm that code is actually **deployed** to the environment in
   question (merged to the branch that environment deploys from -
   `master` for `impactdisciples-a82a8` production, `development` for
   `impactdisciplesdev` - not just sitting on a feature branch).
2. The 5 `FormDefinitionModel` docs those pages point at (their hardcoded
   `readonly formId = '...'` constants) actually exist in that
   environment's own `forms` collection. Forms created via the admin app
   while pointed at one Firebase project do **not** exist in another - dev
   and prod are separate Firestore databases. Confirmed live 2026-08-11:
   all 5 form IDs existed in dev's `forms` collection but were
   **completely missing** from production's, even though the web app code
   referencing them was already written.
3. New submissions are actually landing in `form_submissions`, not the old
   collection, for a real test submission of each form type.

If any of these aren't true yet for the environment you're targeting,
stop - migrating/deleting is premature. (Production was explicitly *not*
touched on 2026-08-11 for exactly this reason: its public site was still
running the old forms, and its `forms` collection didn't have the 5
definitions yet. Scope was cut down to dev-only for that pass.)

### Read/write access

No `firestore:get`-style read command exists in the `firebase` CLI, and
printing an access token via `gcloud auth application-default
print-access-token` gets blocked by this environment's permission
classifier as credential exfiltration-shaped. Application Default
Credentials are already present on this machine though
(`%APPDATA%\gcloud\application_default_credentials.json`), so a plain Node
script using `firebase-admin` works fine without needing that token
printed anywhere:

```js
const admin = require('C:/web/repo/impactdisciples - admin/functions/node_modules/firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'impactdisciplesdev' }); // or impactdisciples-a82a8
const db = admin.firestore();
```

Run these from the scratchpad directory (never commit them - they're
one-off, and several contain inline field-id mappings specific to one
form's current field list, which drifts if that form is ever edited in
Form Builder).

### Step-by-step

1. **Count what's actually there** in both the old collections and
   `form_submissions`, per environment - `.count().get()` on each. Don't
   assume; dev and prod had wildly different pictures (dev: 1 stray record
   total; prod: 43 real historical records).

2. **Read the old record(s) in full** to see their actual field shape
   (`ConsultationRequestModel`/`ConsultationSurveyModel`/
   `LunchAndLearnModel`/`SeminarModel` - typed fields like `firstName`,
   `email`, `churchName`, `date`).

3. **Read the target form's field list and flatten it.**
   `FormDefinitionModel.fields` is a tree - most of the top-level entries
   are `type: 'columns'` layout containers, and the actual
   data-collecting fields (text/email/phone/address/radio/paragraph/...)
   are nested inside `field.columns[].fields`. Recurse the same way
   `flattenDataFields()` (`src/app/common/models/domain/form-field.model.ts`)
   does:

   ```js
   function flatten(fields, out) {
     for (const f of fields || []) {
       if (f.type === 'columns') {
         for (const col of f.columns || []) flatten(col.fields, out);
       } else {
         out.push(f);
       }
     }
     return out;
   }
   ```

4. **Build a field mapping** from each old model's property name to the
   new form's `{id, label, type}`, by matching on label/meaning (e.g. old
   `committment` → the "How committed is the church to making disciples?"
   radio field). This is manual and per-form - the old typed fields and
   the current Form Builder field list aren't guaranteed to line up 1:1
   (an admin may have edited the form since it was built from the
   original dx-form). Fields with no old-side equivalent (e.g. the new
   form gained an Address field the old model never had) still belong in
   `fieldSnapshot` - just leave them out of `values`; `formatFieldValue()`
   already renders a missing value as `-` in the detail dialog.

5. **Write the migrated `FormSubmissionModel` doc(s) into
   `form_submissions`:**

   ```js
   const submission = {
     formId, formName,                    // from the target FormDefinitionModel
     fieldSnapshot,                       // every flattened data field's {id, label, type}
     values,                              // oldKey → newFieldId, only for fields with real data
     submittedAt: new admin.firestore.Timestamp(old.date._seconds, old.date._nanoseconds || 0),
     newRecordStatus: 'seen',             // see note below - load-bearing
     migratedFrom: { collection: 'consultation_surveys', id: doc.id }   // breadcrumb back to the source
   };
   await db.collection('form_submissions').add(submission);
   await doc.ref.delete();                // remove the old doc once its replacement is written
   ```

   **`newRecordStatus: 'seen'` is load-bearing, not cosmetic.**
   `onFormSubmissionCreated`
   (`functions/src/new-record-alerts.functions.ts`) skips tagging/counting
   a doc that already has `newRecordStatus` set at creation time
   (`if (!snap || !data || data.newRecordStatus) return;`). Omitting it
   would make every migrated historical record ring the new-record-alerts
   bell as if it just arrived.

6. **Verify the old collection is actually gone**, not just empty -
   Firestore drops a collection entirely once its last document is
   deleted, so `db.listCollections()` should no longer list it:

   ```js
   const cols = (await db.listCollections()).map(c => c.id);
   ```

   If the old collection had 0 docs to begin with (true for 3 of the 4 in
   dev), there's nothing to delete - an empty collection doesn't persist
   as an entity in Firestore, so the migration is already "done" for it by
   definition.

### Known trap: `meta/newRecordCounts` drift

The bell's aggregate counter (`meta/newRecordCounts`, one field per
source) can silently drift from the real "how many docs actually have
`newRecordStatus == 'new'`" answer, independent of anything in this
migration:

- **Deleting** a still-`new` record (e.g. the Attendees screen's Delete
  action on a registration) never decrements the counter - only an update
  transitioning `new → seen` does (`registerNewRecordTriggers()`'s
  `onUpdate` half). A delete has no matching trigger, so the original
  increment is never clawed back. Live-diagnosed 2026-08-11:
  `eventRegistrations` was stuck at `1` in dev with zero actual `new`
  registrations left.
- A doc that already had `newRecordStatus: 'new'` on it **before** the
  relevant trigger was ever deployed (e.g. a manual test submission
  created pre-migration) gets no increment when the trigger goes live
  later, but if it's subsequently viewed/marked-seen, the `onUpdate` half
  still fires and decrements - net negative drift. Live-diagnosed
  2026-08-11: `formSubmissions` had drifted to `-1` in dev this way, from
  pre-existing Form Builder "Preview & Test Submit" docs.

Symptom: a bell entry that's visible (count > 0) but does nothing useful
when clicked - e.g. `NewRecordAlertsComponent.openEventRegistrations()`
queries the real rows, finds none, and falls back to the bare list instead
of a specific event. **Not a caching/server-restart issue** - confirm by
comparing the stored count against a live query:

```js
const stored = (await db.doc('meta/newRecordCounts').get()).data();
const real = (await db.collection('event-registrations').where('newRecordStatus', '==', 'new').count().get()).data().count;
```

Fix by overwriting the drifted field(s) with the true count - safe to do
any time, it's just a cache of a derived value, not a source of truth:

```js
await db.doc('meta/newRecordCounts').set({ eventRegistrations: 0, formSubmissions: 0 }, { merge: true });
```

### Outstanding for production

- Create the 5 form definitions in `impactdisciples-a82a8`'s `forms`
  collection (currently missing entirely - see Prerequisite step 2
  above).
- Deploy the admin app (hosting + `onFormSubmissionCreated`/`Updated`
  functions) to production.
- Merge the dynamic-form web pages to `master` (triggers the existing
  GitHub Action - `.github/workflows/firebase-hosting-merge.yml` - which
  auto-deploys to the *live* production site on push; not something to do
  incidentally).
- Verify real submissions land in `form_submissions`, then migrate the 43
  existing records (21 consultation requests, 7 surveys, 1 lunch and
  learn, 14 seminars, counted 2026-08-11) using the steps above, per form
  type.
- Only then delete the 4 old collections in production.
- Also delete the 8 now-orphaned old model/service files in
  `impactdisciples-web` if they haven't been already (see
  `src/app/common/{models/domain,services/data}/{consultation-request,
  consultation-survey,lunch-and-learn,seminar}.*` - dev's copies were
  removed 2026-08-11).

---

## Newsletter/Prayer Team subscribers: collection merged into `customers` flags — RESOLVED 2026-08-15

**Found**: 2026-08-14, mid-implementation. **Fully completed**: 2026-08-15,
across dev and prod both. Recorded here for the historical record - the
steps below no longer need doing, this is what happened.

Subscriber state (`SubscriptionModel`) used to live in its own
`subscriptions` collection (one doc per email+type, itself a 2026-era merge
of the even older `newsletter_subscriptions`/`prayer_team_subscriptions`
collections - see `scripts/recreate-subscriptions.js`'s own header comment
for that earlier merge). It's now 2 booleans + dates directly on the
matching `customers` doc instead - `subscribedToNewsletter`/
`newsletterSubscribedDate`, `subscribedToPrayerTeam`/
`prayerTeamSubscribedDate` (see `CustomerModel`'s own comment).

What got done, in order:
1. `functions/src/subscriptions.functions.ts`'s `subscribe_to_email_list`/
   `unsubscribe_from_email_list` rewritten to target `customers` instead of
   `subscriptions`; every admin-app read/write (Subscribers screen,
   Subscriber Report) moved the same way.
2. `scripts/migrate-subscriptions-to-customers.js` (dry-run by default,
   `--execute` to write) run for real against both dev and prod - matches a
   `customers` doc by email (creates one if none exists), sets the flag/
   date. Verified idempotent (re-running found 0 remaining writes needed)
   on both. Both dev and prod actually had the merged `subscriptions`
   collection populated (~4,490 docs each) - the pre-merge
   `newsletter_subscriptions`/`prayer_team_subscriptions` collections
   turned out empty on both, so no separate pass over those was needed.
3. Data-quality cleanup on the backfill's output, both environments: 240
   newly-created customers with no name at all deleted (verified zero
   purchase/event-registration history first); 75 full-names-crammed-into-
   firstName split on the last space; 1 period-separated name split; 70
   remaining single-word names with no order/registration history deleted.
   Every existing customer keeps both a first and last name as a result.
4. `impactdisciples-web`'s `SubscriptionService.createSubscription()` (the
   thing that was actually writing into `subscriptions` directly via the
   client SDK) rewritten to POST to `subscribe_to_email_list` instead - see
   that repo's own history. Deployed to its prod hosting.
5. The now-orphaned `onSubscriptionCreated`/`onSubscriptionUpdated` Cloud
   Functions (the 4th new-record-alert trigger pair, already removed from
   source earlier but still deployed since no deploy had targeted them by
   name) deleted from both dev and prod via `firebase functions:delete`.
6. The `subscriptions` collection itself deleted outright (not left
   orphaned like `users` - see CLAUDE.md's Firestore collection naming
   note) via `firebase firestore:delete subscriptions --recursive`, both
   dev and prod. Confirmed 0 documents remaining in both afterward.

---

## Coaches split into Coaches + Impact Team — RESOLVED 2026-08-15 (both repos, dev)

**Found**: 2026-08-15, mid-implementation. **Fully completed** same day: admin side (this repo, dev +
prod) and `impactdisciples-web`'s own "My Team" page (`impactdisciples-web` commit `47e5707`, dev).
`impactdisciples-web` turned out to be a sibling directory on disk (`impactdisciples - web`, not a
separate machine/session needed) - reachable and editable directly, not actually out of reach the way
first assumed. All 26 remaining `coaches` also bulk-activated (`isActive: true`, both dev and prod -
see `scripts/activate-all-coaches.js`) at the user's request, since `coaches`' own `sortOrder` field
is what drives display order on 2 public pages that were never touched by this split (Summit "Featured
Speakers" carousel, event schedule breakout-speaker lookup - both still correctly read `coaches`,
unaffected, since that data never moved).

`coaches` used to serve 2 unrelated purposes at once: driving the public site's "My Team" page (via a
`teamPageSortOrder` field, separate from the collection's own `sortOrder`) and providing Summit
breakout-session instructors. See `CLAUDE.md`'s Firestore collection naming note for the full
before/after shape.

What got done, in order:
1. New `impact_team` collection/model/service (`ImpactTeamMemberModel`/`ImpactTeamService`) and a new
   admin screen, Web Manager > Team Page (`web-manager/team-page/`), mirroring
   `coach-dialog.component.ts` closely minus the now-pointless `teamPageSortOrder` split (just
   `sortOrder`).
2. `teamPageSortOrder` removed from `CoachModel`/`coach-dialog.component.ts`/`coaches.component.ts`'s
   column list - Coaches is breakout-only now.
3. Every place that resolves a coach id to a display name or offers a coach picker
   (`course-dialog.component.ts`'s Coaches field, `coachLabelFor()` in `session-block.util.ts`, the
   Agenda wizard/canvas/grid, the Breakout Block/Agenda Item dialogs) updated to work off a combined
   Coaches + Impact Team array/picker - see the new shared `Instructor` interface
   (`session-block.util.ts`) and `course-dialog.component.ts`'s `<mat-optgroup>`-grouped Coaches field.
4. `scripts/move-team-page-coaches-to-impact-team.js` (dry-run by default, `--execute` to write) run
   for real against both dev and prod - moves (not copies) every `coaches` doc with
   `teamPageSortOrder` set into `impact_team` **under the same document id**, deleting the original.
   Reusing the id (not a fresh auto-id) is what keeps any existing `Course.coachIds` referencing that
   person resolving correctly post-move, with zero changes needed to any course document. Both
   environments had the identical 13 of 39 coaches with `teamPageSortOrder` set (dev appears to have
   been cloned from prod at some point - same 13 document ids on both). Verified idempotent (0
   remaining) on both after running.
5. Admin app (both dev and prod hosting) redeployed with all of the above.
6. `impactdisciples-web`'s own `team.component.ts`/`team-details.component.ts` (the actual `/team` +
   `/team-details/:id` pages) switched to a new independent `ImpactTeamMemberModel`/`ImpactTeamService`
   copy in that repo's own `common/` (no longer a shared submodule with this repo - see that repo's own
   CLAUDE.md), reading `impact_team` ordered by `sortOrder` instead of `coaches` ordered by
   `teamPageSortOrder`. `summit.component.ts`/`summit-preview.component.ts` (Summit "Featured Speakers"
   carousel) and `schedule.component.ts` (event registration's breakout-speaker lookup) deliberately
   left untouched - both correctly resolve actual breakout instructors, which is still `coaches`'
   job; that data never moved. Verified live against real dev data (12 of 13 active members render
   correctly, 1 inactive correctly filtered, detail page resolves real bio/photo). Deployed to
   `impactdisciples-web`'s dev AND prod hosting (that repo's CLAUDE.md normally holds prod deploys for
   explicit go-ahead each time, same spirit as this repo's own master-merge rule - given here).

## Contacts & Events restructure: Organizations/Locations/Courses/Coaches — dev done 2026-08-19, PROD PENDING

Branch `feature/contacts-events-restructure` (both repos). Organizations moved into Contacts
Manager (child locations edited inside the org details view; standalone Locations screen retired),
events reference organization + optional location with a denormalized `venue` snapshot the public
site renders, Summit is pinned to the one `isSummitVenue` location (Crossroads HWY 16,
`3RuXPpbwBrD8c1toHw0c` in both projects' data) whose rooms are edited on the Summit screen, the
Courses concept is retired (breakout agenda items carry their own text/description/coaches;
registrations were ALREADY agenda-item-keyed — no registration migration), coaches are created only
via the Summit quick-create (Coaches screen is edit-only), and qualifying form submissions offer an
admin-reviewed "Create Organization + Contact" action.

Data scripts (all idempotent, dry-run first) — **run on dev 2026-08-19; each must run on prod AT
prod-deploy time, BEFORE the app deploys** (order matters for the flatten - the web app's course
fallbacks cover the gap, but don't stretch it):

1. `node scripts/pin-summit-venue.js --project=prod`
2. `node scripts/backfill-org-point-of-contact.js --project=prod` (17/18 orgs updated on dev)
3. `node scripts/flatten-courses-onto-agenda-items.js --project=prod` (25 items / 1 event on dev;
   take a fresh `node scripts/export.js --project=prod` backup of `events` first)
4. `node scripts/migrate-screenkey-renames-2.js --project=prod` (org key moved, locations/courses
   keys dropped; 0 grants affected on dev)
5. `node scripts/repair-location-organizations.js` — dry-run reported 8 orphan locations +
   anomalies needing per-doc user decisions (fill ORPHAN_ASSIGNMENTS before a write run); NOT yet
   applied anywhere.

Deferred cleanup (do AFTER prod ships and the flatten has run there): delete admin
`CourseService`/`CourseModel`, web `course.service.ts` + the CourseNamePipe shim + the
breakout.util legacy-course fallbacks (keep `sameBreakoutSession`'s course-id branch forever - old
items keep their ids); optionally tighten `courses` Firestore read rules to staff; optional
`backfill-event-venues.js`. The `courses` collection itself is left inert (the `home_page_popups`
precedent).
