import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { E2E_CATALOG } from '@impact-common/shared/testing/e2e-catalog';
import { E2eDashboardComponent } from './e2e-dashboard.component';
import { E2eRun, E2eRunService } from './e2e-run.service';

// TestBed as an INJECTOR only - nothing renders. Resolves constructor
// params and `inject()` fields alike.
//
// The behaviour worth pinning is the JOIN and how it reports absence. This
// screen's whole job is to say what is covered and how current that is, so
// the failure that matters is it quietly implying more than it knows -
// showing a suite as fine because no run was ever published, or rendering
// "Invalid Date" at whoever is trying to decide whether to trust it.

function run(over: Partial<E2eRun> = {}): E2eRun {
  return {
    suiteId: 'e2e-admin',
    status: 'passed',
    passed: 10, failed: 0, flaky: 0, skipped: 0,
    durationMs: 65000,
    finishedAt: new Date(),
    ...over,
  } as E2eRun;
}

function setup(runs: E2eRun[] = []) {
  const bySuite = new Map(runs.map((r) => [r.suiteId, r]));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      E2eDashboardComponent,
      { provide: E2eRunService, useValue: { runsBySuite: () => of(bySuite) } },
    ],
  });
  const component = TestBed.inject(E2eDashboardComponent);
  component.ngOnInit();
  return component;
}

describe('E2eDashboardComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('the catalog', () => {
    it('lists every suite, whether or not it has ever run', () => {
      const component = setup();
      expect(component.rows.length).toBe(E2E_CATALOG.length);
    });

    it('gives each suite its own description, areas and apps', () => {
      const component = setup();
      const admin = component.rows.find((r) => r.suite.id === 'e2e-admin')!;
      expect(admin.suite.description.length).toBeGreaterThan(20);
      expect(admin.areas.length).toBeGreaterThan(0);
      expect(admin.apps).toContain('admin');
    });

    it('names every app a cross-app suite actually spans', () => {
      // The point of "apps involved": e2e-cross is the suite where more
      // than one app has to be working, and the dashboard should say so.
      const component = setup();
      const cross = component.rows.find((r) => r.suite.id === 'e2e-cross')!;
      expect(cross.apps.length).toBeGreaterThan(1);
      expect(cross.apps).toContain('reader');
    });

    it('de-duplicates areas across a suite\'s specs', () => {
      const component = setup();
      for (const row of component.rows) {
        expect(new Set(row.areas).size).withContext(row.suite.id).toBe(row.areas.length);
      }
    });
  });

  describe('reporting a suite that has never run', () => {
    it('says so rather than showing it as passing', () => {
      // The failure mode of every dashboard that only counts what it has
      // results for: silence reading as health.
      const component = setup();
      const row = component.rows[0];
      expect(row.run).toBeNull();
      expect(component.statusLabel(null)).toBe('Never run');
      expect(component.statusClass(null)).toBe('never');
      expect(component.lastRunRelative(null)).toBe('—');
    });

    it('counts never-run suites in the summary', () => {
      const component = setup();
      expect(component.summary.never).toBe(E2E_CATALOG.length);
      expect(component.summary.passing).toBe(0);
    });
  });

  describe('joining a published run', () => {
    it('attaches it to the right suite and leaves the others alone', () => {
      const component = setup([run({ suiteId: 'e2e-admin' })]);
      expect(component.rows.find((r) => r.suite.id === 'e2e-admin')!.run).toBeTruthy();
      expect(component.rows.find((r) => r.suite.id === 'web-e2e')!.run).toBeNull();
    });

    it('reports a flaky run as unreliable, not passing', () => {
      // A flaky pass still cost someone a re-run.
      const component = setup([run({ status: 'unreliable', flaky: 1 })]);
      expect(component.statusLabel(component.rows.find((r) => r.suite.id === 'e2e-admin')!.run))
        .toBe('Unreliable');
      expect(component.summary.unreliable).toBe(1);
      expect(component.summary.passing).toBe(0);
    });

    it('reports a failing run as failing', () => {
      const component = setup([run({ status: 'failed', failed: 2 })]);
      expect(component.summary.failing).toBe(1);
    });
  });

  describe('how recent the run was', () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60000);

    it('reads as elapsed time, not a timestamp', () => {
      // "3 hours ago" answers "is this current?"; a date makes the reader
      // do the subtraction.
      expect(setup([run({ finishedAt: minutesAgo(0) })]).lastRunRelative(run({ finishedAt: minutesAgo(0) })))
        .toBe('just now');
      const c = setup();
      expect(c.lastRunRelative(run({ finishedAt: minutesAgo(5) }))).toBe('5 minutes ago');
      expect(c.lastRunRelative(run({ finishedAt: minutesAgo(60) }))).toBe('1 hour ago');
      expect(c.lastRunRelative(run({ finishedAt: minutesAgo(60 * 26) }))).toBe('1 day ago');
    });

    it('singularises one unit correctly', () => {
      const c = setup();
      expect(c.lastRunRelative(run({ finishedAt: minutesAgo(1) }))).toBe('1 minute ago');
    });

    it('flags a run older than a week as stale', () => {
      const c = setup();
      expect(c.isStale(run({ finishedAt: minutesAgo(60 * 24 * 8) }))).toBeTrue();
      expect(c.isStale(run({ finishedAt: minutesAgo(60 * 24 * 2) }))).toBeFalse();
      expect(c.isStale(null)).toBeFalse();
    });

    it('accepts a Firestore Timestamp, a Date or an ISO string', () => {
      // The SDK hands back a Timestamp; a hand-written record may not.
      // Rendering "Invalid Date" at the reader is the thing to avoid.
      const c = setup();
      const when = minutesAgo(30);
      const asTimestamp = { toDate: () => when };
      expect(c.lastRunRelative(run({ finishedAt: asTimestamp }))).toBe('30 minutes ago');
      expect(c.lastRunRelative(run({ finishedAt: when }))).toBe('30 minutes ago');
      expect(c.lastRunRelative(run({ finishedAt: when.toISOString() }))).toBe('30 minutes ago');
    });

    it('says "never published" rather than Invalid Date for junk', () => {
      const c = setup();
      expect(c.lastRunExact(run({ finishedAt: 'not a date' }))).toContain('never published');
      expect(c.lastRunRelative(run({ finishedAt: 12345 }))).toBe('—');
    });
  });

  describe('duration', () => {
    it('reads in minutes and seconds once past a minute', () => {
      const c = setup();
      expect(c.duration(run({ durationMs: 45000 }))).toBe('45s');
      expect(c.duration(run({ durationMs: 476000 }))).toBe('7m 56s');
    });

    it('is blank when unknown', () => {
      const c = setup();
      expect(c.duration(run({ durationMs: 0 }))).toBe('');
      expect(c.duration(null)).toBe('');
    });
  });

  describe('expanding a suite', () => {
    it('starts collapsed and toggles both ways', () => {
      const c = setup();
      expect(c.isExpanded('e2e-admin')).toBeFalse();
      c.toggle('e2e-admin');
      expect(c.isExpanded('e2e-admin')).toBeTrue();
      c.toggle('e2e-admin');
      expect(c.isExpanded('e2e-admin')).toBeFalse();
    });

    it('tracks suites independently', () => {
      const c = setup();
      c.toggle('e2e-admin');
      expect(c.isExpanded('web-e2e')).toBeFalse();
    });
  });
});
