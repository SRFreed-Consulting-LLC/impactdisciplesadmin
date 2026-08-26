import { Component, OnInit, inject } from '@angular/core';
import {
  E2E_CATALOG,
  E2eSuite,
  IMPACT_APP_LABELS,
  ImpactApp,
  appsInSuite,
} from '@impact-common/shared/testing/e2e-catalog';
import { E2eRun, E2eRunService } from './e2e-run.service';

/** A suite plus whatever we know about its last run. */
interface SuiteRow {
  suite: E2eSuite;
  apps: ImpactApp[];
  /** Every functional area this suite touches, de-duplicated. */
  areas: string[];
  run: E2eRun | null;
  totalTests: number;
}

// The E2E Dashboard: what is tested, where, and how it last went.
//
// Two sources, joined by suite id, and they are different KINDS of thing:
//   - the catalog (shared/testing/e2e-catalog.ts) is authored and versioned
//     with the tests - what each suite proves, its functional areas, and
//     which apps have to be working for it to pass
//   - the last run comes from the `e2e_runs` collection, written by each
//     repo's scripts/publish-e2e-run.js
//
// A suite with no record reports NEVER RUN rather than being hidden or
// assumed green. That is the whole point: a dashboard that only shows what
// it has results for quietly overstates how much is covered.
@Component({
  selector: 'app-e2e-dashboard',
  templateUrl: './e2e-dashboard.component.html',
  styleUrls: ['./e2e-dashboard.component.scss'],
  standalone: false,
})
export class E2eDashboardComponent implements OnInit {
  private readonly runService = inject(E2eRunService);

  rows: SuiteRow[] = [];
  loading = true;
  expanded = new Set<string>();

  readonly appLabels = IMPACT_APP_LABELS;

  ngOnInit(): void {
    this.rows = E2E_CATALOG.map((suite) => this.toRow(suite, null));

    this.runService.runsBySuite().subscribe((bySuite) => {
      this.rows = E2E_CATALOG.map((suite) => this.toRow(suite, bySuite.get(suite.id) ?? null));
      this.loading = false;
    });
  }

  private toRow(suite: E2eSuite, run: E2eRun | null): SuiteRow {
    return {
      suite,
      apps: appsInSuite(suite),
      areas: [...new Set(suite.specs.flatMap((s) => s.areas))].sort(),
      run,
      totalTests: suite.specs.reduce((n, s) => n + s.tests, 0),
    };
  }

  toggle(suiteId: string): void {
    if (this.expanded.has(suiteId)) {
      this.expanded.delete(suiteId);
    } else {
      this.expanded.add(suiteId);
    }
  }

  isExpanded(suiteId: string): boolean {
    return this.expanded.has(suiteId);
  }

  /** green / amber / red / grey, driven by the published status. */
  statusClass(run: E2eRun | null): string {
    if (!run) return 'never';
    if (run.status === 'failed') return 'failed';
    if (run.status === 'unreliable') return 'unreliable';
    return 'passed';
  }

  statusLabel(run: E2eRun | null): string {
    if (!run) return 'Never run';
    if (run.status === 'failed') return 'Failing';
    if (run.status === 'unreliable') return 'Unreliable';
    return 'Passing';
  }

  /**
   * "3 hours ago" beats a timestamp here: the question this screen answers
   * is "is this current?", and an absolute date makes the reader do the
   * subtraction. The exact time is still on the row as a tooltip.
   */
  lastRunRelative(run: E2eRun | null): string {
    const when = this.toDate(run?.finishedAt);
    if (!when) return '—';

    const minutes = Math.round((Date.now() - when.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }

  lastRunExact(run: E2eRun | null): string {
    const when = this.toDate(run?.finishedAt);
    return when ? when.toLocaleString() : 'This suite has never published a run.';
  }

  /** A run older than a week is reported as stale - see the template. */
  isStale(run: E2eRun | null): boolean {
    const when = this.toDate(run?.finishedAt);
    if (!when) return false;
    return Date.now() - when.getTime() > 7 * 24 * 60 * 60 * 1000;
  }

  duration(run: E2eRun | null): string {
    if (!run?.durationMs) return '';
    const seconds = Math.round(run.durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  /**
   * finishedAt arrives as a Firestore Timestamp from the SDK, but as an ISO
   * string or Date if a record was ever written by hand - accept all three
   * rather than rendering "Invalid Date" at whoever is reading.
   */
  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const withToDate = value as { toDate?: () => Date };
    if (typeof withToDate.toDate === 'function') return withToDate.toDate();
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  get summary(): { passing: number; unreliable: number; failing: number; never: number } {
    return {
      passing: this.rows.filter((r) => r.run?.status === 'passed').length,
      unreliable: this.rows.filter((r) => r.run?.status === 'unreliable').length,
      failing: this.rows.filter((r) => r.run?.status === 'failed').length,
      never: this.rows.filter((r) => !r.run).length,
    };
  }
}
