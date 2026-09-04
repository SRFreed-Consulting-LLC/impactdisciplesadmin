import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SitePagesNavService } from 'src/app/page-manager/pages/site-pages-nav.service';
import { NAV_CONFIG, NavGroup, NavLeaf, displayGroupLabel } from '../main-screen/nav-config';
import {
  customerName as customerNameOf,
  isNewOrder,
  itemSummary as itemSummaryOf,
} from 'src/app/contacts-manager/fulfillment/order-display.util';
import { MatDialog } from '@angular/material/dialog';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { OrderWorkflowDialogComponent } from '../../shared/order-workflow-dialog/order-workflow-dialog.component';
import { RouteRequestDialogComponent } from '../../shared/route-request-dialog/route-request-dialog.component';
import { CreateOrgContactDialogComponent } from '../../shared/create-org-contact-dialog/create-org-contact-dialog.component';
import { extractSubmission, submitterIdentity } from '../../shared/form-submission-mapping.util';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
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

/** One screen the signed-in person may open - the "Your screens" list an
 *  Employee's Home is made of. */
export interface DashboardScreenLink {
  group: string;
  label: string;
  /** The group route, e.g. '/page-manager'. */
  path: string;
  /** The ?tab= value - the leaf slug. */
  tab: string;
}

// The screen each preview section belongs to. A section shows only to
// someone who could open that screen - the preview IS that screen's data
// (customer names on orders, registrant counts, who submitted a request),
// so showing it to an Employee granted none of them was the leak the
// owner closed on 2026-09-03: "a Home with the things he's allowed to see,
// that's it."
export const DASHBOARD_SECTION_KEYS = {
  orders: 'contacts-manager.fulfillment',
  events: 'events-manager.events',
  requests: 'data.custom-form-submissions'
} as const;

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
  // inject(), not constructor parameters - new code, house style; declared
  // FIRST because inject() runs in field-initializer order.
  private readonly permissionService = inject(PermissionService);
  private readonly authService = inject(AdminAuthService);
  private readonly sitePagesNav = inject(SitePagesNavService);
  private readonly router = inject(Router);

  /** Set once this Home has sent a non-Administrator on to their first
   *  screen, so a later emission (the pages stream landing) cannot send
   *  them a second time. */
  private forwarded = false;

  /** Which preview sections this person may see - see DASHBOARD_SECTION_KEYS. */
  access = { orders: false, events: false, requests: false };
  /** Loads already started, so a re-emission of the user never restarts one. */
  private started = { orders: false, events: false, requests: false };

  /** An Employee's Home lists the screens they hold, in nav order. Empty
   *  for Admin/Root, whose Home is the previews themselves. */
  myScreens: DashboardScreenLink[] = [];

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
    // Permission-driven, and LIVE: the same loggedInUser$ PermissionService
    // reads, so the cold-load race (permissions landing after first render,
    // live-diagnosed 2026-08-18 on the tab shells) resolves here too - a
    // section appears the moment its grant is known, and a preview nobody
    // may see is never loaded, not merely hidden.
    //
    // The streamed pages are in the combine too: on a cold load the user
    // lands BEFORE page_content does, and a list built then would miss every
    // page the person is granted - the first live run listed two screens of
    // Kevin's three for exactly that reason.
    combineLatest([this.authService.dao.loggedInUser$, this.sitePagesNav.leaves$])
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(() => this.applyAccess());
  }

  isFullAccess(): boolean {
    return this.permissionService.isFullAccess();
  }

  private applyAccess(): void {
    this.access = {
      orders: this.permissionService.canView(DASHBOARD_SECTION_KEYS.orders),
      events: this.permissionService.canView(DASHBOARD_SECTION_KEYS.events),
      requests: this.permissionService.canView(DASHBOARD_SECTION_KEYS.requests)
    };
    if (this.access.orders && !this.started.orders) {
      this.started.orders = true;
      this.loadRecentOrders();
    }
    if (this.access.events && !this.started.events) {
      this.started.events = true;
      this.loadUpcomingEvents();
    }
    if (this.access.requests && !this.started.requests) {
      this.started.requests = true;
      this.loadNewRequests();
    }
    this.myScreens = this.isFullAccess() ? [] : this.grantedScreens();

    // A NON-ADMINISTRATOR DOES NOT STAY ON HOME (owner, 2026-09-03): with
    // one screen, Home is a detour to it; with several, the first in the
    // list is where they start. The flat drawer carries no HOME row for
    // them, so this is the only way Home is ever reached - the sign-in
    // landing, the logo, a bookmark - and each of those should end on
    // their first screen. Someone granted nothing yet stays here and reads
    // the "ask an administrator" line instead of a blank page.
    if (!this.isFullAccess() && this.myScreens.length > 0 && !this.forwarded) {
      this.forwarded = true;
      const first = this.myScreens[0];
      void this.router.navigate([first.path], { queryParams: { tab: first.tab }, replaceUrl: true });
    }
  }

  /**
   * Every leaf the signed-in person may open, walking NAV_CONFIG in drawer
   * order and folding in the pages streamed from page_content under PAGES -
   * the same two sources and the same canViewNavItem() gate the drawer uses,
   * so Home and the drawer can never disagree about what somebody holds.
   */
  private grantedScreens(): DashboardScreenLink[] {
    const links: DashboardScreenLink[] = [];
    for (const group of NAV_CONFIG) {
      if (!group.items) {
        continue;
      }
      const taken = new Set(group.items.map((item) => item.slug));
      const streamed = group.id === 'page-manager'
        ? this.sitePagesNav.leaves.filter((leaf) => !taken.has(leaf.slug))
        : [];
      for (const leaf of [...group.items, ...streamed]) {
        if (leaf.hideFromNav || !this.permissionService.canViewNavItem(group, leaf)) {
          continue;
        }
        links.push(this.linkFor(group, leaf));
      }
    }
    return links;
  }

  private linkFor(group: NavGroup, leaf: NavLeaf): DashboardScreenLink {
    // The drawer's own label diet ("CAMPAIGNS", not "CAMPAIGNS MANAGER") so
    // the list and the drawer name a group the same way.
    return { group: displayGroupLabel(group.label), label: leaf.label, path: `/${group.id}`, tab: leaf.slug };
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
    return isNewOrder(item);
  }

  itemSummary(item: CheckoutForm): string {
    return itemSummaryOf(item);
  }

  customerName(item: CheckoutForm): string {
    return customerNameOf(item);
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
    // Prefer the denormalized venue snapshot (2026-08 restructure - an
    // event at a single-site org has no location record at all); fall back
    // to the location lookup for events saved before it existed.
    if (item.venue?.name) return item.venue.name;
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

  // Shared label heuristics (form-submission-mapping.util.ts) - this used
  // to be a locally duplicated copy of route-request-dialog's own
  // submitterIdentity().
  private submissionIdentity(item: FormSubmissionModel): string {
    return submitterIdentity(item);
  }

  // Which create action a request qualifies for (content-driven, same
  // heuristics the submission detail dialog uses): an org-name-ish field
  // offers Create Organization + Contact, bare person identity offers
  // Create Contact, an already-actioned submission offers nothing.
  createModeFor(row: DashboardRequestRow): 'org' | 'contact' | null {
    if (row.raw.createdRecords) {
      return null;
    }
    const extracted = extractSubmission(row.raw);
    if (extracted.orgName && extracted.hasIdentity) {
      return 'org';
    }
    return extracted.hasIdentity ? 'contact' : null;
  }

  createFromRequest(row: DashboardRequestRow, event: Event): void {
    event.stopPropagation();
    const mode = this.createModeFor(row);
    if (!mode) {
      return;
    }
    this.dialog.open(CreateOrgContactDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { submission: row.raw, mode }
    });
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
