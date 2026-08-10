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
