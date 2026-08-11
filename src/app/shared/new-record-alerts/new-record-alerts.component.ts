import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { NewRecordAlertsService, NewRecordCounts } from 'src/app/common/services/data/new-record-alerts.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';

interface AlertSource {
  key: keyof NewRecordCounts;
  label: string;
  route: string[];
  queryParams?: Record<string, string>;
}

// Top-bar bell: one badge for the total across all sources, a dropdown
// breaking that total down per source. Clicking an entry navigates to that
// source's master list - the list screen itself (see
// new-record-tracking.util.ts) is what actually highlights the new rows and
// marks them seen once viewed; this component only knows how to get there.
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
  { key: 'formSubmissions', label: 'Custom Form Submissions', route: ['/web-manager'], queryParams: { tab: 'custom-form-submissions' } },
  { key: 'purchases', label: 'Purchases', route: ['/store-manager'], queryParams: { tab: 'purchases' } }
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
    this.router.navigate(entry.route, entry.queryParams ? { queryParams: entry.queryParams } : {});
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
      this.router.navigate(entry.route, queryParams ? { queryParams } : {});
    });
  }
}
