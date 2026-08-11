import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { NewRecordAlertsService, NewRecordCounts } from 'src/app/common/services/data/new-record-alerts.service';

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
// Event Registrations has no flat cross-event list to deep-link into
// (registrations are only ever viewed nested inside a specific event's
// editor - see event-attendees.component.ts) - it lands on the Events
// Manager list itself rather than a specific event.
//
// formSubmissions replaces the old Requests Manager sources
// (consultationRequests, consultationSurveys, lunchAndLearns, seminars),
// dropped when that module was removed in favor of Custom Form Submissions
// - see NewRecordCounts's own comment.
const ALERT_SOURCES: AlertSource[] = [
  { key: 'eventRegistrations', label: 'Event Registrations', route: ['/events-manager'] },
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

  constructor(private service: NewRecordAlertsService, private router: Router) {
    this.entries$ = this.service.counts$.pipe(
      map((counts) => ALERT_SOURCES
        .map((source) => ({ ...source, count: counts[source.key] ?? 0 }))
        .filter((entry) => entry.count > 0)
      )
    );

    this.total$ = this.entries$.pipe(map((entries) => entries.reduce((sum, e) => sum + e.count, 0)));
  }

  open(entry: AlertEntry): void {
    this.router.navigate(entry.route, entry.queryParams ? { queryParams: entry.queryParams } : {});
  }
}
