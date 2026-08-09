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

// Top-bar bell: one badge for the total across all 6 sources, a dropdown
// breaking that total down per source. Clicking an entry navigates to that
// source's master list - the list screen itself (see
// new-record-tracking.util.ts) is what actually highlights the new rows and
// marks them seen once viewed; this component only knows how to get there.
//
// Event Registrations has no flat cross-event list to deep-link into
// (registrations are only ever viewed nested inside a specific event's
// editor - see event-attendees.component.ts) - it lands on the Events
// Manager list itself rather than a specific event.
const ALERT_SOURCES: AlertSource[] = [
  { key: 'eventRegistrations', label: 'Event Registrations', route: ['/events-manager'] },
  { key: 'consultationRequests', label: 'Consultation Requests', route: ['/requests-manager'], queryParams: { tab: 'consultation-requests' } },
  { key: 'consultationSurveys', label: 'Consultation Surveys', route: ['/requests-manager'], queryParams: { tab: 'consultation-surveys' } },
  { key: 'lunchAndLearns', label: 'Lunch and Learn Requests', route: ['/requests-manager'], queryParams: { tab: 'lunch-and-learns' } },
  { key: 'seminars', label: 'Seminar Requests', route: ['/requests-manager'], queryParams: { tab: 'seminars' } },
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
