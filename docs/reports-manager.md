# Reports Manager

> Split out of the admin repo's CLAUDE.md on 2026-08-26 to keep the
> always-loaded file small. Read this when working in `src/app/reports-manager/`.

### Reports Manager (`src/app/reports-manager/`)

**Six** screens today, sharing one shell — `reports-manager.component.ts` reads its tab list from
`NAV_CONFIG`'s `'reports-manager'` group and renders one `@if (selectedTab === '<label>')` block per
report (no per-report Angular routes; a new report is a new `NavLeaf` + a new `@if` block + a
declaration in `ReportsManagerModule`, not a new route). Note the `@if` matches on the nav **label**,
so renaming a tab in `nav-config.ts` blanks its report unless this template changes with it.

They no longer share one *implementation*. Three still use the original criteria-form shape (a
checkboxed filter set, a "Generate Report" button, `ReportColumnSet`, and the grid stripped down to
a table with `[showHeader]="false" [showFilterRow]="false"`). Two — Digital Book Users and, since
2026-09-04, Contacts — load their population up front and let `<app-data-grid>` own filtering,
sorting, the Columns menu and the export. Which shape a new report wants is a real question, and the
answer is usually "does it need a Firestore query to be answerable at all":

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
- **Contact Report** (`contact-report/`, Reports Manager → Contacts; nee Customer Report) — every
  contact, in one list. **Rebuilt 2026-09-04** (owner: "I really just want them to see a list of all
  the contacts"): it was a criteria form gating a State query behind a Generate button, so the
  screen's resting state was an empty page and a hint telling you to pick a state — you could not
  answer "how many contacts do we have" without first narrowing to somewhere. It now reads the whole
  `customers` collection on open and hands it to the grid.
  - It has **never had a date criterion** and cannot grow one: `ContactModel` has no
    signup/created-date field at all (customer docs are upserted from purchases/event registrations
    — see `functions/src/customer-upsert.functions.ts` — with no timestamp stamped anywhere). Same
    for a List criterion; there is no list-membership mechanism wired to Contacts.
  - Dropping the State criterion **lost no capability**: the grid's filter row filters any column,
    both state columns included, without a round trip. The query existed only because Firestore
    cannot OR across `billingAddress.state` and `shippingAddress.state`, so the report ran two
    queries and deduped by id — a problem that does not exist for a list already in memory. It also
    no longer leans on `stateVariants()`, since the underlying data is now normalized to 2-letter
    codes (see MIGRATION.md, "US states stored two ways").
  - **It reads ~5,600 documents on open, deliberately.** That is the right trade for a report meant
    to be exported whole, and it is what Digital Book Users already does. It is *not* the pattern
    for a list SCREEN — Contacts under `contacts-manager` stays on `PagedCollectionSource`.
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
- **Digital Book User Report** (`digital-book-user-report/`, Reports Manager → Digital Book Users)
  — every reader-app patron (`libraryUsers`, *not* this app's staff `admin_users`) in signup order,
  the books they can read, and their standing in Impact Groups. Four one-shot reads joined
  client-side: `libraryUsers`, every `discussionGroups` doc, every membership via one unfiltered
  `collectionGroup('members')` query (admin-only under `firestore.rules`), and the flat book list for
  id → title; plus a fetch-by-id pass over only the purchases a licence actually names, for the
  coupon column. Things worth knowing before editing it:
  - **It is the odd one out structurally, on purpose.** Standalone (so it sits in the module's
    `imports`, not `declarations`), `inject()` + signals, no `ReportColumnSet` — the grid owns
    columns and export. It follows the convention every screen added since the library-manager
    consolidation follows, and Contacts now matches it.
  - **`LibraryUser.createdAt` is a bare epoch NUMBER**, not a Timestamp, and the grid's `date`
    columns run values through `dateFromTimestamp()`, which does not recognise one — hence the
    explicit `new Date(user.createdAt)`. That is the library side's convention across every one of
    its collections and is not something to "fix"; see MIGRATION.md.
  - **`'International'` outranks `'Licensed'`** in the access column: an international patron reads
    the whole catalogue free regardless of `licensedBookIds`, so counting licences understates them.
  - **A group's creator also holds an `approved` member doc of their own**, so the membership join
    must skip groups already counted as led or every leader reads as "Leader & Member" of their own
    single group. `'rejected'` requests are dropped; `'pending'` is its own role, because an
    unanswered join request is an actionable state rather than a blank.
  - Provenance says **"Legacy" rather than guessing** — most licences predate `source` being
    recorded and carry nothing to infer it from.
  - KNOWN CAVEAT, documented on the component: `createdAt` for a patron imported by the reader
    repo's `backfill-users.js` is the IMPORT date, not their signup, so the oldest stretch of the
    report bunches onto one day. Last Login is shown beside it as the honest second signal.

- **Commissions Report** (`commissions-report/`, Reports Manager → Commissions, added 2026-09-04) —
  what each affiliate's coupon code sold in one month. Grouped **coupon → purchase → line items**,
  with a total per purchase, and a total plus a commission per coupon.
  - **It is the only report that aggregates, and that is deliberate.** Group-by was stripped out of
    Purchase and Subscriber reports on 2026-08-15 ("every row is always one real document") and this
    doc carried that as a rule. The owner asked for grouping here specifically, because a commission
    statement whose subtotals you cannot see is not a commission statement. Don't "restore
    consistency" by flattening it.
  - **`CouponModel.isAffilliate`** is the flag — note the double-l, which is the spelling in the
    model and in Firestore. 9 such coupons on prod, matching 87 purchases lifetime. The sibling
    fields are inconsistent too (`affilliateName`, but `affiliatePaypalAccount`); that's the data.
    `affilliateName` is blank on all 9, so the UI falls back to the code.
  - **The commission rate is a hard-coded 10% and must NOT be read from `percentOff`.** They are
    both 10 today and that is a coincidence: `percentOff` is the discount the *customer* receives;
    the commission is what the *affiliate* earns. Wiring one to the other would look correct and
    would silently change nine people's pay the first time a coupon is set to 15% for a promotion.
  - **A total means the goods, excluding shipping and tax**, summed from the line items rather than
    read off `CheckoutForm.total`. Two reasons: `total` is the whole charge (it includes
    `shippingRate` and `estimatedTaxes`, which are not the affiliate's to be credited with), and it
    is not always internally consistent in older records — one live purchase stores `total: 150`
    where its own parts sum to 153.26. Summing lines also makes the subtotal column visibly add up
    to the total beside it, which is what anyone checking a statement by hand will try first.
  - Line unit price is `discountPrice ?? salePrice ?? price`. Falling straight back to `price` would
    report every affiliate sale about 10% high.
  - **Fully refunded purchases are excluded**; partials are not. `refundedAt` is written only under
    `plan.isFullRefund` (`functions/src/store-refund.functions.ts`), so its presence is the test.
    Netting a partial off would need a rule about which line the money came off, and there isn't one.

Conventions established by Purchase Report. The first two hold for every report; the rest describe
the **criteria-form** shape specifically, and Contacts and Digital Book Users deliberately depart
from them (see each above):

- A dedicated `ReportRow` interface distinct from the underlying entity model (e.g. `CheckoutForm`)
  — a report row is a flat, report-specific shape, and in grouped/aggregate mode a synthesized
  aggregate that doesn't correspond to any single real document.
- Criteria drive **real Firestore queries** (`queryAllByMultiValue`/`QueryParam`) wherever the data
  supports it, not a full-collection client-side filter. Where Firestore can't OR across two fields
  in one query (e.g. matching a State against both billing and shipping address), the report queries
  twice and merges/dedupes by id client-side.
- Column visibility, grid columns and Excel export come from
  **`reports-manager/report-column-set.ts`** — construct a
  `ReportColumnSet<TRow>` with your `ReportColumn[]` and expose thin delegates
  (`columns`, `displayedColumns`, `toggleColumn`, `columnLabel`, `gridColumns`,
  `exportExcel`) so the shared template markup binds unchanged. Put a column's
  `type`/`dateFormat` **on the column definition**; do not reintroduce a
  per-report `toGridColumn()` if-chain, which is what this replaced.

  Until 2026-08-28 this line read "reuses list-screen infra: `ColumnDef[]`
  visibility toggles…", which described an abstraction that did not exist —
  each report carried its own `interface ColumnDef` plus six byte-identical
  methods, so a fourth report meant copying ~90 lines of TypeScript before
  writing a query. The doc is what made that invisible; it is accurate now.
- Rendered with `DataGridColumn`/`app-data-grid` at
  `[showHeader]="false" [showFilterRow]="false"` — Columns/Export/criteria stay
  each component's own hand-rolled `app-list-header`, not the grid's built-in
  versions — over `exportToExcel`/`ExcelColumn` (`shared/table-export.util.ts`),
  same conventions as the List-screen section above. **The two grid-owned reports do the
  opposite**: they leave the header and filter row on and pass `exportFileName`, because with no
  criteria form there is nothing for a hand-rolled header to hold. The grid's own export covers the
  *filtered* rows (`exportExcel()` runs over `visibleRows`), so it is not a downgrade.
- Known limitation on Purchase Report specifically: a **date-range criterion is only as good as the
  stored date shape**, and a malformed `{seconds,nanoseconds}` map will not match a Firestore range
  query even when its real date falls inside the range. As of 2026-09-04 there is no such value left
  in either project (see MIGRATION.md, "Date fields"), so the report is currently accurate — but the
  criterion is still the place this would resurface first if a bad write ever lands again. A
  "specific product(s)" filter was deliberately dropped as infeasible without a schema
  change (cart items aren't a scalar-array-queryable field) — documented inline with a pointer
  to `MIGRATION.md`.
- Before adding a criterion that filters/groups by some field, confirm that field is actually
  queryable data on the entity, not something that only exists in a downstream, one-way-synced
  system (see Contact Report's own header comment on why it has no List filter — Mailchimp
  membership is push-only, never mirrored back to Firestore, see Cloud Functions section below).
