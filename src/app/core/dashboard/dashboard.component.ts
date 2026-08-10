import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { ConsultationRequestService } from 'src/app/common/services/data/consultation-request.service';
import { ConsultationSurveyService } from 'src/app/common/services/data/consultation-survey.service';
import { LunchAndLearnService } from 'src/app/common/services/data/lunch-and-learn.service';
import { SeminarService } from 'src/app/common/services/data/seminar.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { FULFILLMENT_STEPS, segmentState } from '../../store-manager/fulfillment/fulfillment-steps';

interface DashboardEventRow {
  id: string;
  name: string;
  startDateMs: number;
  location: string;
  isOnline: boolean;
  registeredCount: number | null; // null = enrichment read failed, hide rather than show 0
}

type RequestType = 'consultation-request' | 'consultation-survey' | 'lunch-and-learn' | 'seminar';

interface DashboardRequestRow {
  id: string;
  type: RequestType;
  typeLabel: string;
  name: string;
  detail: string;
  dateMs: number;
  isNew: boolean;
  queryParams: { tab: string };
}

// Home - the app's landing page (routed at both '/' and '/home', see
// app-routing.module.ts). 3 read-only preview sections, each pointing at
// the real screen that owns the underlying data: Recent Orders (the
// Fulfillment workflow - same status/sort definition as
// FulfillmentComponent.loadOrders(), just capped and read-only here, no
// action buttons), Upcoming Events, and New Requests (merged across all 4
// Requests Manager collections). Every section is a one-time getAll(), not
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
    private consultationRequestService: ConsultationRequestService,
    private consultationSurveyService: ConsultationSurveyService,
    private lunchAndLearnService: LunchAndLearnService,
    private seminarService: SeminarService,
    private router: Router
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
      // first within each group.
      this.recentOrders = items
        .filter((item) => item.fulfillmentStatus && item.fulfillmentStatus !== 'closed')
        .sort((a, b) => this.newRank(a) - this.newRank(b) || this.toMillis(a.dateProcessed) - this.toMillis(b.dateProcessed))
        .slice(0, 5);
      this.ordersLoading = false;
    }).catch(() => {
      this.ordersLoading = false;
      this.ordersFailed = true;
    });
  }

  segmentState(item: CheckoutForm, index: number): 'done' | 'current' | 'pending' {
    return segmentState(item.fulfillmentStatus, index);
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
      if (registrations) {
        registrations.forEach((r) => {
          if (!r.eventId) return;
          countByEventId.set(r.eventId, (countByEventId.get(r.eventId) ?? 0) + 1);
        });
      }

      const now = Date.now();
      this.upcomingEvents = eventsResult.value
        .filter((e) => e.isActive)
        .map((e) => ({
          id: e.id!,
          name: e.eventName ?? 'Untitled Event',
          startDateMs: this.toMillis(e.startDate),
          location: this.locationName(e, locations),
          isOnline: !!e.isOnline,
          registeredCount: registrations ? (countByEventId.get(e.id!) ?? 0) : null
        }))
        .filter((row) => row.startDateMs >= now)
        .sort((a, b) => a.startDateMs - b.startDateMs)
        .slice(0, 5);

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

    Promise.allSettled([
      this.consultationRequestService.getAll(),
      this.consultationSurveyService.getAll(),
      this.lunchAndLearnService.getAll(),
      this.seminarService.getAll()
    ]).then(([consultations, surveys, lunches, seminars]) => {
      const rows: DashboardRequestRow[] = [];

      if (consultations.status === 'fulfilled') {
        rows.push(...consultations.value.map((r) => ({
          id: r.id!,
          type: 'consultation-request' as const,
          typeLabel: 'Consultation',
          name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email || 'Unknown',
          detail: r.email ?? '',
          dateMs: this.toMillis(r.date),
          isNew: r.newRecordStatus === 'new',
          queryParams: { tab: 'consultation-requests' }
        })));
      }

      if (surveys.status === 'fulfilled') {
        rows.push(...surveys.value.map((r) => ({
          id: r.id!,
          type: 'consultation-survey' as const,
          typeLabel: 'Survey',
          name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email || 'Unknown',
          detail: r.churchName ?? '',
          dateMs: this.toMillis(r.date),
          isNew: r.newRecordStatus === 'new',
          queryParams: { tab: 'consultation-surveys' }
        })));
      }

      if (lunches.status === 'fulfilled') {
        rows.push(...lunches.value.map((r) => ({
          id: r.id!,
          type: 'lunch-and-learn' as const,
          typeLabel: 'Lunch & Learn',
          name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email || 'Unknown',
          detail: r.locationName ?? '',
          dateMs: this.toMillis(r.date),
          isNew: r.newRecordStatus === 'new',
          queryParams: { tab: 'lunch-and-learns' }
        })));
      }

      if (seminars.status === 'fulfilled') {
        // SeminarModel has no firstName/lastName - email + the requesting
        // coordinator's name is all there is to identify the submitter.
        rows.push(...seminars.value.map((r) => ({
          id: r.id!,
          type: 'seminar' as const,
          typeLabel: 'Seminar',
          name: r.eventCoordinator || r.email || 'Unknown',
          detail: r.preferredLocationName ?? '',
          dateMs: this.toMillis(r.date),
          isNew: r.newRecordStatus === 'new',
          queryParams: { tab: 'seminars' }
        })));
      }

      // Every source failing (not just one) is the only case worth
      // surfacing as a real failure state - a single rejected source just
      // silently contributes zero rows (allSettled, not all).
      this.requestsFailed = [consultations, surveys, lunches, seminars].every((r) => r.status === 'rejected');

      this.newRequests = rows
        .sort((a, b) => this.requestSortRank(b.isNew) - this.requestSortRank(a.isNew) || b.dateMs - a.dateMs)
        .slice(0, 8);

      this.requestsLoading = false;
    });
  }

  viewRequest(row: DashboardRequestRow): void {
    this.router.navigate(['/requests-manager'], { queryParams: row.queryParams });
  }

  // Higher rank sorts first - 'new' requests before already-seen ones,
  // ties broken by dateMs descending (see the sort call above).
  private requestSortRank(isNew: boolean): number {
    return isNew ? 1 : 0;
  }

  // Handles both a real Date (most services' fromFirestore already
  // converts) and a raw Firestore Timestamp (LunchAndLearnService leaves
  // its own `date` field unconverted) via the same dateFromTimestamp()
  // every DAO's fromFirestore hook already uses - not a bespoke parser.
  private toMillis(value: unknown): number {
    const date = dateFromTimestamp(value);
    return date instanceof Date ? date.getTime() : 0;
  }
}
