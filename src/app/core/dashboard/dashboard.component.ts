import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
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
import { FULFILLMENT_STEPS, segmentState } from '../../customers-manager/fulfillment/fulfillment-steps';

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
// Every section is a one-time getAll(), not
// a live streamAll() - this is the page every login lands on, so it
// shouldn't add more standing listeners on top of whatever else is already
// live; getAll()'s own retry hardening (see firebase.dao.ts's
// FIRESTORE_RETRY_COUNT) already makes a one-time read resilience-
// equivalent to a stream here. The 3 sections load independently (not one
// combined combineLatest/forkJoin) so Recent Orders - the primary section -
// never waits on the slowest of three unrelated reads, and a failure in one
// section can't blank the other two.
@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss'],
    standalone: false
})
export class DashboardComponent implements OnInit {
  steps = FULFILLMENT_STEPS;

  recentOrders: CheckoutForm[] = [];
  ordersLoading = true;
  ordersFailed = false;

  upcomingEvents: DashboardEventRow[] = [];
  eventsLoading = true;
  eventsFailed = false;

  newRequests: DashboardRequestRow[] = [];
  requestsLoading = true;
  requestsFailed = false;

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

  // ---- Recent Orders ----

  loadRecentOrders(): void {
    this.ordersLoading = true;
    this.ordersFailed = false;

    this.purchasesService.getAll().then((items) => {
      // Same definition of "needs fulfillment" as FulfillmentComponent's
      // own loadOrders() - 'new' orders first, then oldest-dateProcessed-
      // first within each group. Deliberately uncapped (matches the
      // original spec - "all orders that still need to be fulfilled");
      // the horizontally-scrolling card row is what keeps this usable
      // when there are a lot of them, not a slice().
      this.recentOrders = items
        .filter((item) => item.fulfillmentStatus && item.fulfillmentStatus !== 'closed')
        .sort((a, b) => this.newRank(a) - this.newRank(b) || toMillis(a.dateProcessed) - toMillis(b.dateProcessed));
      this.ordersLoading = false;
    }).catch(() => {
      this.ordersLoading = false;
      this.ordersFailed = true;
    });
  }

  // Opens the same fully-functional workflow (Acknowledge/Print Label/Mark
  // Packaged/Mark Shipped) as the real Fulfillment screen, scoped to this
  // one order - see OrderWorkflowDialogComponent. Refreshes the list on
  // close regardless of what happened inside (cheap one-time read; simpler
  // and just as correct as tracking exactly what changed).
  openOrderDialog(item: CheckoutForm): void {
    this.dialog.open(OrderWorkflowDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: { item }
    }).afterClosed().subscribe(() => this.loadRecentOrders());
  }

  segmentState(item: CheckoutForm, index: number): 'done' | 'current' | 'pending' {
    return segmentState(item.fulfillmentStatus, index);
  }

  // Tooltip text for the condensed progress bar - the table row no longer
  // has room for the full label strip the old card layout showed under the
  // bar (see FULFILLMENT_STEPS), so surface the order's current step name
  // this way instead.
  segmentLabel(item: CheckoutForm): string {
    return this.steps.find((s) => s.status === item.fulfillmentStatus)?.statusLabel ?? 'Unknown';
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
      this.locationService.getAll(),
      this.eventRegistrationService.getAll()
    ]).then(([eventsResult, locationsResult, registrationsResult]) => {
      if (eventsResult.status === 'rejected') {
        this.eventsFailed = true;
        this.eventsLoading = false;
        return;
      }

      const locations = locationsResult.status === 'fulfilled' ? locationsResult.value : [];
      // Registration count is a nice-to-have enrichment, not load-bearing -
      // a failed read here just means every row shows no count, the table
      // itself still renders.
      const registrations = registrationsResult.status === 'fulfilled' ? registrationsResult.value : null;

      const countByEventId = new Map<string, number>();
      // Unseen-signup count per event - same source data as countByEventId
      // above, just narrowed to newRecordStatus === 'new' (see
      // new-record-tracking.util.ts). Drives the "+N NEW" badge below;
      // clears itself once an admin opens that event's Attendees tab, same
      // as every other new-record indicator in the app.
      const newCountByEventId = new Map<string, number>();
      if (registrations) {
        registrations.forEach((r) => {
          if (!r.eventId) return;
          countByEventId.set(r.eventId, (countByEventId.get(r.eventId) ?? 0) + 1);
          if (r.newRecordStatus === 'new') {
            newCountByEventId.set(r.eventId, (newCountByEventId.get(r.eventId) ?? 0) + 1);
          }
        });
      }

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
            registeredCount: registrations ? (countByEventId.get(e.id!) ?? 0) : null,
            newRegisteredCount: registrations ? (newCountByEventId.get(e.id!) ?? 0) : null
          };
        })
        // Future events AND events happening right now - anything whose
        // end (real or fallback) hasn't passed yet.
        .filter((row) => row.endDateMs >= now)
        .sort((a, b) => a.startDateMs - b.startDateMs)
        .slice(0, 8);

      this.eventsLoading = false;
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

    this.formSubmissionService.getAll().then((items) => {
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
    }).catch(() => {
      this.requestsLoading = false;
      this.requestsFailed = true;
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
  // here goes straight to. Reloads the list on close so a just-routed
  // request drops off immediately, same refresh-after-close pattern as
  // openOrderDialog() above.
  routeRequest(row: DashboardRequestRow): void {
    this.dialog.open(RouteRequestDialogComponent, {
      width: '860px',
      maxWidth: '95vw',
      maxHeight: '85vh',
      data: { item: row.raw }
    }).afterClosed().subscribe(() => this.loadNewRequests());
  }

  // Higher rank sorts first - 'new' requests before already-seen ones,
  // ties broken by dateMs descending (see the sort call above).
  private requestSortRank(isNew: boolean): number {
    return isNew ? 1 : 0;
  }
}
