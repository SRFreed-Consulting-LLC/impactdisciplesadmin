# Reports Manager

> Split out of the admin repo's CLAUDE.md on 2026-08-26 to keep the
> always-loaded file small. Read this when working in `src/app/reports-manager/`.

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
- Still rendered with `DataGridColumn`/`app-data-grid` at
  `[showHeader]="false" [showFilterRow]="false"` — Columns/Export/criteria stay
  each component's own hand-rolled `app-list-header`, not the grid's built-in
  versions — over `exportToExcel`/`ExcelColumn` (`shared/table-export.util.ts`),
  same conventions as the List-screen section above.
- Known limitation on Purchase Report specifically, documented inline and in `MIGRATION.md`:
  malformed date fields (see next section) can silently drop matching rows from a date-range report
  query. A "specific product(s)" filter was deliberately dropped as infeasible without a schema
  change (cart items aren't a scalar-array-queryable field) — also documented inline with a pointer
  to `MIGRATION.md`.
- Before adding a criterion that filters/groups by some field, confirm that field is actually
  queryable data on the entity, not something that only exists in a downstream, one-way-synced
  system (see Contact Report's own header comment on why it has no List filter — Mailchimp
  membership is push-only, never mirrored back to Firestore, see Cloud Functions section below).
