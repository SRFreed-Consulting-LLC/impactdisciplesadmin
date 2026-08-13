import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { NewRecordAlertsService, NewRecordCounts } from 'src/app/common/services/data/new-record-alerts.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { NewRecordTracker } from '../new-record-tracking.util';

interface AlertSource {
  key: keyof NewRecordCounts;
  label: string;
  // Only Event Registrations still deep-links elsewhere - it has no live,
  // dedicated view on the Dashboard the way Purchases/Custom Form
  // Submissions now do (Recent Orders / New Requests, both live - see
  // dashboard.component.ts), so it's the one source that still needs
  // somewhere more specific to go than just "the Dashboard". route/
  // queryParams are omitted entirely for every other source; open() below
  // sends those straight to /home instead.
  route?: string[];
  queryParams?: Record<string, string>;
}

// Top-bar bell: one badge for the total across all sources, a dropdown
// breaking that total down per source. Clicking a Purchases/Custom Form
// Submissions entry just lands on the Dashboard - both now show up there
// live (Recent Orders / New Requests), so there's nothing more specific to
// deep-link into any more. Event Registrations is the one exception (see
// AlertSource.route's own comment and openEventRegistrations() below) - the
// list screen itself (see new-record-tracking.util.ts) is what actually
// highlights the new rows and marks them seen once viewed; this component
// only knows how to get there.
//
// Event Registrations has no flat cross-event list to deep-link into by
// default (registrations are only ever viewed nested inside a specific
// event's editor - see event-attendees.component.ts) - open() below
// resolves which event(s) actually have the new registration(s) on click
// and deep-links straight into that one's Attendees tab (events.component.ts's
// ?eventId=&eventTab= handling) instead of just the bare Events list.
//
// formSubmissions replaces the old Requests Manager sources
// (consultationRequests, consultationSurveys, lunchAndLearns, seminars),
// dropped when that module was removed in favor of Custom Form Submissions
// - see NewRecordCounts's own comment.
const ALERT_SOURCES: AlertSource[] = [
  { key: 'eventRegistrations', label: 'Event Registrations', route: ['/events-manager'], queryParams: { tab: 'events' } },
  { key: 'formSubmissions', label: 'Custom Form Submissions' },
  { key: 'purchases', label: 'Purchases' }
];

interface AlertEntry extends AlertSource {
  count: number;
}

@Component({
    selector: 'app-new-record-alerts',
    templateUrl: './new-record-alerts.component.html',
    styleUrls: ['./new-record-alerts.component.scss'],
    standalone: false
})
export class NewRecordAlertsComponent {
  entries$: Observable<AlertEntry[]>;
  total$: Observable<number>;

  constructor(
    private service: NewRecordAlertsService,
    private registrationService: EventRegistrationService,
    private purchasesService: PurchasesService,
    private formSubmissionService: FormSubmissionService,
    private router: Router
  ) {
    this.entries$ = this.service.counts$.pipe(
      map((counts) => ALERT_SOURCES
        .map((source) => ({ ...source, count: counts[source.key] ?? 0 }))
        .filter((entry) => entry.count > 0)
      )
    );

    this.total$ = this.entries$.pipe(map((entries) => entries.reduce((sum, e) => sum + e.count, 0)));
  }

  open(entry: AlertEntry): void {
    if (entry.key === 'eventRegistrations') {
      this.openEventRegistrations(entry);
      return;
    }
    // Purchases/Custom Form Submissions now show up live right on the
    // Dashboard (Recent Orders / New Requests) - no need to deep-link
    // anywhere else, just land there.
    this.router.navigate(['/home']);
    // Resets the bell's own count for this source - same newRecordStatus
    // 'new' -> 'seen' write NewRecordTracker already does when the real
    // list screen loads (see new-record-tracking.util.ts), just triggered
    // by this click instead of a screen visit, since landing on the
    // Dashboard doesn't run that screen's own tracker. Deliberately only
    // touches newRecordStatus - fulfillmentStatus (the separate "NEW"
    // badge on Recent Orders/the Fulfillment screen) is untouched here on
    // purpose, so an order still reads as needing attention until it's
    // actually acknowledged through that real workflow, not just because
    // someone clicked the bell.
    this.markSourceSeen(entry.key);
  }

  private markSourceSeen(key: 'purchases' | 'formSubmissions'): void {
    if (key === 'purchases') {
      this.purchasesService.getAllByValue('newRecordStatus', 'new').then((items) => {
        new NewRecordTracker(this.purchasesService).capture(items);
      });
    } else {
      this.formSubmissionService.getAllByValue('newRecordStatus', 'new').then((items) => {
        new NewRecordTracker(this.formSubmissionService).capture(items);
      });
    }
  }

  // Finds which event the most recent still-unseen registration belongs to
  // and deep-links straight there, Attendees tab pre-selected, instead of
  // dropping the admin on the bare Events list to go hunt for it - most
  // recent wins if new registrations happen to span more than one event,
  // since that's the one whoever clicked the bell almost certainly means.
  // Falls back to the plain Events list if the query comes back empty (the
  // count and the underlying rows can momentarily disagree - e.g. someone
  // else just marked it seen between the badge rendering and this click).
  private openEventRegistrations(entry: AlertEntry): void {
    this.registrationService.getAllByValue('newRecordStatus', 'new').then((registrations) => {
      const latest = registrations
        .filter((r) => !!r.eventId)
        .sort((a, b) => toMillis(b.registrationDate) - toMillis(a.registrationDate))[0];

      const queryParams = latest ? { ...entry.queryParams, eventId: latest.eventId, eventTab: 'attendees' } : entry.queryParams;
      // route is always set for the eventRegistrations entry (the only one
      // this method is ever called for) - the ?? fallback only matters if
      // that ever stops being true, so this never silently no-ops.
      this.router.navigate(entry.route ?? ['/events-manager'], queryParams ? { queryParams } : {});
    });
  }
}
