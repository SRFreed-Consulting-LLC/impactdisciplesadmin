import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { OrderWorkflowDialogComponent } from '../../shared/order-workflow-dialog/order-workflow-dialog.component';
import { RouteRequestDialogComponent } from '../../shared/route-request-dialog/route-request-dialog.component';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { FulfillmentStep, segmentState, stepsFor } from '../../contacts-manager/fulfillment/fulfillment-steps';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';

interface DashboardEventRow {
  id: string;
  name: string;
  startDateMs: number;
  endDateMs: number; // real endDate, or startDateMs itself for single-point events
  location: string;
  isOnline: boolean;
  isOngoing: boolean; // startDate has passed but the event hasn't ended yet
  registeredCount: number | null; // null = enrichment read failed, hide rather than show 0
  newRegisteredCount: number | null; // same null convention - unseen (newRecordStatus === 'new') signups
}

interface DashboardRequestRow {
  id: string;
  typeLabel: string;
  name: string;
  detail: string;
  dateMs: number;
  isNew: boolean;
  raw: FormSubmissionModel;
}

// Home - the app's landing page (routed at both '/' and '/home', see
// app-routing.module.ts). 3 read-only preview sections, each pointing at
// the real screen that owns the underlying data: Recent Orders (the
// Fulfillment workflow - same status/sort definition as
// FulfillmentComponent.loadOrders(), just capped and read-only here, no
// action buttons), Upcoming Events, and New Requests (Web Manager's Custom
// Form Submissions - the old 4-collection Requests Manager this replaced).
//
// Recent Orders and New Requests are live now (explicit user request - a
// new purchase/request should appear without a manual refresh), Upcoming
// Events stays a one-time read (not asked for, and less time-sensitive).
// Recent Orders uses a *scoped* live query (fulfillmentStatus != 'closed'),
// not streamAll() over the whole purchases collection - that collection is
// large (2000+ docs) and this app deliberately moved off whole-collection
// streamAll() for exactly that size of collection elsewhere (see Products/
// Customers/Purchases' own PagedCollectionSource usage) - a scoped query
// keeps this page from adding an expensive standing listener over data
// nobody here needs to see. New Requests uses streamAll() instead (see its
// own comment below for why a scoped query doesn't work there) - that
// collection is small/staff-bounded, not the same cost concern.
@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss'],
    standalone: false
})
export class DashboardComponent implements OnInit, OnDestroy {
  recentOrders: CheckoutForm[] = [];
  ordersLoading = true;
  ordersFailed = false;

  upcomingEvents: DashboardEventRow[] = [];
  eventsLoading = true;
  eventsFailed = false;

  newRequests: DashboardRequestRow[] = [];
  requestsLoading = true;
  requestsFailed = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private purchasesService: PurchasesService,
    private eventService: EventService,
    private locationService: LocationService,
    private eventRegistrationService: EventRegistrationService,
    private formSubmissionService: FormSubmissionService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadRecentOrders();
    this.loadUpcomingEvents();
    this.loadNewRequests();
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // ---- Recent Orders ----

  loadRecentOrders(): void {
    this.ordersLoading = true;
    this.ordersFailed = false;

    // Scoped live query, not a one-time getAll() any more - see the class
    // comment above. Every purchase always has a fulfillmentStatus now (see
    // the processedStatus->fulfillmentStatus migration), so this already
    // fully replaces the old client-side "item.fulfillmentStatus &&" part
    // of the filter - nothing comes back missing the field to filter out.
    this.purchasesService.queryStreamByValue(
      'fulfillmentStatus', WhereFilterOperandKeys.notEqual, 'closed', undefined,
      () => { this.ordersFailed = true; }
    ).pipe(takeUntil(this.ngUnsubscribe)).subscribe((items) => {
      // Same definition of "needs fulfillment" as FulfillmentComponent's
      // own loadOrders() - 'new' orders first, then newest-dateProcessed-
      // first within each group. Deliberately uncapped (matches the
      // original spec - "all orders that still need to be fulfilled");
      // the horizontally-scrolling card row is what keeps this usable
      // when there are a lot of them, not a slice().
      this.recentOrders = items
        .sort((a, b) => this.newRank(a) - this.newRank(b) || toMillis(b.dateProcessed) - toMillis(a.dateProcessed));
      this.ordersLoading = false;
    });
  }

  // Opens the same fully-functional workflow (Acknowledge/Print Label/Mark
  // Packaged/Mark Shipped) as the real Fulfillment screen, scoped to this
  // one order - see OrderWorkflowDialogComponent. No refresh-on-close call
  // any more - the list is a live subscription now, it already reflects
  // whatever the dialog just changed without this.
  openOrderDialog(item: CheckoutForm): void {
    this.dialog.open(OrderWorkflowDialogComponent, {
      // Wide enough for the 'received' step's three actions (print label /
      // Amazon / picked up) to align instead of wrapping raggedly.
      width: '640px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  // Path-aware per order (standard vs Amazon branch) - see stepsFor()'s
  // own comment in fulfillment-steps.ts.
  stepsFor(item: CheckoutForm): FulfillmentStep[] {
    return stepsFor(item.fulfillmentStatus, item.statusHistory);
  }

  segmentState(item: CheckoutForm, index: number): 'done' | 'current' | 'pending' {
    return segmentState(this.stepsFor(item), item.fulfillmentStatus, index);
  }

  // Tooltip text for the condensed progress bar - the table row no longer
  // has room for the full label strip the old card layout showed under the
  // bar, so surface the order's current step name this way instead.
  segmentLabel(item: CheckoutForm): string {
    return this.stepsFor(item).find((s) => s.status === item.fulfillmentStatus)?.statusLabel ?? 'Unknown';
  }

  isNew(item: CheckoutForm): boolean {
    return item.fulfillmentStatus === 'new';
  }

  itemSummary(item: CheckoutForm): string {
    return (item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', ') || '—';
  }

  customerName(item: CheckoutForm): string {
    return [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email || 'Unknown';
  }

  private newRank(item: CheckoutForm): number {
    return this.isNew(item) ? 0 : 1;
  }

  // ---- Upcoming Events ----

  loadUpcomingEvents(): void {
    this.eventsLoading = true;
    this.eventsFailed = false;

    Promise.allSettled([
      this.eventService.getAll(),
      this.locationService.getAll()
    ]).then(([eventsResult, locationsResult]) => {
      if (eventsResult.status === 'rejected') {
        this.eventsFailed = true;
        this.eventsLoading = false;
        return;
      }

      const locations = locationsResult.status === 'fulfilled' ? locationsResult.value : [];

      const now = Date.now();
      this.upcomingEvents = eventsResult.value
        .filter((e) => e.isActive)
        .map((e) => {
          const startDateMs = toMillis(e.startDate);
          // No endDate set - treat the event as ending the moment it
          // starts (a single-point event), same fallback used for the
          // "still relevant" filter below.
          const endDateMs = e.endDate ? toMillis(e.endDate) : startDateMs;
          return {
            id: e.id!,
            name: e.eventName ?? 'Untitled Event',
            startDateMs,
            endDateMs,
            location: this.locationName(e, locations),
            isOnline: !!e.isOnline,
            isOngoing: startDateMs <= now && endDateMs >= now,
            // Counts are enriched in below by a bounded query; null until then.
            registeredCount: null as number | null,
            newRegisteredCount: null as number | null
          };
        })
        // Future events AND events happening right now - anything whose
        // end (real or fallback) hasn't passed yet.
        .filter((row) => row.endDateMs >= now)
        .sort((a, b) => a.startDateMs - b.startDateMs)
        .slice(0, 8);

      this.eventsLoading = false;

      // Registration counts are a nice-to-have enrichment for just the <=8
      // events shown, so query only those events' registrations (an `in`
      // query, bounded by the 8-event slice above - well within Firestore's
      // 10-value `in` cap) instead of downloading the entire, ever-growing
      // event-registrations collection on every dashboard load (P6). A
      // failed/empty read just leaves the counts null and the rows still
      // render.
      const eventIds = this.upcomingEvents.map((row) => row.id).filter(Boolean);
      if (!eventIds.length) {
        return;
      }

      this.eventRegistrationService
        .queryAllByMultiValue([new QueryParam('eventId', WhereFilterOperandKeys.in, eventIds)])
        .then((registrations) => {
          const countByEventId = new Map<string, number>();
          // Unseen-signup count per event - same source data, narrowed to
          // newRecordStatus === 'new' (see new-record-tracking.util.ts).
          // Drives the "+N NEW" badge; clears once an admin opens that
          // event's Attendees tab, same as every other new-record indicator.
          const newCountByEventId = new Map<string, number>();
          registrations.forEach((r) => {
            if (!r.eventId) return;
            countByEventId.set(r.eventId, (countByEventId.get(r.eventId) ?? 0) + 1);
            if (r.newRecordStatus === 'new') {
              newCountByEventId.set(r.eventId, (newCountByEventId.get(r.eventId) ?? 0) + 1);
            }
          });

          this.upcomingEvents = this.upcomingEvents.map((row) => ({
            ...row,
            registeredCount: countByEventId.get(row.id) ?? 0,
            newRegisteredCount: newCountByEventId.get(row.id) ?? 0
          }));
        })
        .catch(() => {
          // Counts stay null; the event rows have already rendered.
        });
    });
  }

  private locationName(item: EventModel, locations: { id?: string; name: string }[]): string {
    if (item.isOnline) return 'Online';
    const id = typeof item.location === 'string' ? item.location : item.location?.id;
    return locations.find((l) => l.id === id)?.name ?? '—';
  }

  // ---- New Requests ----

  loadNewRequests(): void {
    this.requestsLoading = true;
    this.requestsFailed = false;

    // Live, but bounded: the 100 most recent submissions (submittedAt desc)
    // rather than the old whole-collection streamAll(). The still-open
    // filter stays client-side - "still open" means status !== 'routed' OR
    // completely missing (every submission that existed before this status
    // field shipped, see the filter's own comment below), and Firestore's
    // != excludes docs missing the field entirely, the opposite of what's
    // needed - there's no single query that expresses this. A plain
    // orderBy + limit needs no composite index, and this panel only ever
    // shows 8 rows, so 100 recent candidates is plenty; an open request
    // older than the 100 newest submissions would drop off this panel, but
    // it stays fully visible/actionable on Web Manager's Custom Form
    // Submissions screen.
    this.formSubmissionService.streamAllOrdered('submittedAt', 'desc', 100, () => { this.requestsFailed = true; })
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((items) => {
        this.newRequests = items
          // 'routed' requests have already been handed off to a staff person
          // (see RouteRequestDialogComponent) and are considered closed - they
          // stay visible on Web Manager's Custom Form Submissions screen, just
          // not here. undefined/'open' both count as still-open (undefined =
          // every submission that existed before this status field shipped).
          .filter((r) => r.status !== 'routed')
          .map((r) => ({
            id: r.id!,
            typeLabel: r.formName,
            name: this.submissionIdentity(r),
            detail: r.isTest ? 'Test submission' : '',
            dateMs: toMillis(r.submittedAt),
            isNew: r.newRecordStatus === 'new',
            raw: r
          }))
          .sort((a, b) => this.requestSortRank(b.isNew) - this.requestSortRank(a.isNew) || b.dateMs - a.dateMs)
          .slice(0, 8);

        this.requestsLoading = false;
      });
  }

  // Best-effort submitter identification for a fully dynamic form: prefer
  // an Email-type field's value (every request form so far has had one),
  // falling back to a text field whose label reads like a name field, then
  // giving up rather than guessing wrong. There's no fixed firstName/
  // lastName shape to rely on any more - fields are whatever the admin who
  // built the form dragged onto the canvas.
  private submissionIdentity(item: FormSubmissionModel): string {
    const emailField = item.fieldSnapshot?.find((f) => f.type === 'email');
    if (emailField && item.values?.[emailField.id]) {
      return String(item.values[emailField.id]);
    }
    const nameField = item.fieldSnapshot?.find((f) => f.type === 'text' && /name/i.test(f.label));
    if (nameField && item.values?.[nameField.id]) {
      return String(item.values[nameField.id]);
    }
    return 'Unknown';
  }

  // Opens the forward/route workflow directly (not a plain detail view -
  // see RouteRequestDialogComponent) - a request landing on this dashboard
  // needs to be triaged to a staff person, so that's the action a click
  // here goes straight to. No refresh-on-close call any more - the list is
  // a live subscription now (see loadNewRequests()), a just-routed request
  // drops off on its own once its status write lands.
  routeRequest(row: DashboardRequestRow): void {
    this.dialog.open(RouteRequestDialogComponent, {
      width: '860px',
      maxWidth: '95vw',
      maxHeight: '85vh',
      data: { item: row.raw }
    });
  }

  // Higher rank sorts first - 'new' requests before already-seen ones,
  // ties broken by dateMs descending (see the sort call above).
  private requestSortRank(isNew: boolean): number {
    return isNew ? 1 : 0;
  }
}
