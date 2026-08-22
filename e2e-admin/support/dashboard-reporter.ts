import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult,
} from '@playwright/test/reporter';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AREAS, areaOf, FunctionalArea } from './areas';

// Emits e2e-admin/results/dashboard.json - the machine-readable state of
// every functional area, which scripts/render-e2e-dashboard.js turns into
// the red/yellow/green page.
//
// The point of this reporter (rather than Playwright's own HTML report) is
// that it answers a different question. Playwright's report answers "which
// assertion failed"; this one answers "what is broken for a user, and what
// do I do about it". So each failure carries a plain-language explanation,
// a suggested fix, and the functional area it takes down - and areas with
// no tests at all report as UNKNOWN rather than silently reading green,
// which is the failure mode of every dashboard that only counts what ran.

interface FailureDetail {
  test: string;
  file: string;
  line: number;
  /** Playwright's own message, trimmed of ANSI. */
  raw: string;
  /** What this means in plain language. */
  explanation: string;
  /** What to do about it. */
  suggestion: string;
  kind: string;
  durationMs: number;
}

interface AreaResult {
  id: string;
  title: string;
  owns: string;
  layer: string;
  dataCoveredBy?: string;
  status: 'green' | 'yellow' | 'red' | 'unknown';
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  failures: FailureDetail[];
}

const ANSI = /\[[0-9;]*m/g;

/**
 * Maps a Playwright failure onto a human explanation + a suggested fix.
 *
 * Ordered most-specific first. These patterns are deliberately about the
 * SHAPE of the failure, not about any one test - a timeout waiting for a
 * locator always means the same thing (the screen did not render what the
 * test asked for) regardless of which screen it was.
 */
function classify(raw: string, area: FunctionalArea | undefined): { kind: string; explanation: string; suggestion: string } {
  const a = area?.title ?? 'This area';

  if (/Error: page\.goto|net::ERR_CONNECTION_REFUSED/i.test(raw)) {
    return {
      kind: 'app-not-served',
      explanation: 'The browser could not reach the admin app at all - the dev server was not up when the test ran.',
      suggestion: 'Start the app with `npm run start-emu` (port 5200) and re-run. If it is running, check ng serve compiled without an error.',
    };
  }
  if (/Cannot find module|Failed to fetch dynamically imported module|ChunkLoadError/i.test(raw)) {
    return {
      kind: 'lazy-chunk-broken',
      explanation: `A lazily-loaded route chunk failed to load, so ${a} never mounted. This is the classic breakage after a module or route is split.`,
      suggestion: 'Check the loadChildren path and that the referenced NgModule is exported under the name the route imports. A typo here compiles fine and only fails at runtime.',
    };
  }
  if (/NG04002|Cannot match any routes/i.test(raw)) {
    return {
      kind: 'route-missing',
      explanation: `The router had no route for the URL the test opened, so ${a} is unreachable by that path.`,
      suggestion: 'Compare the route definition against the URL the app itself navigates to. After a route move, the navigate() call and the Routes array drift apart easily.',
    };
  }
  if (/NG0(2|3)\d{3}|NullInjectorError|No provider for/i.test(raw)) {
    return {
      kind: 'di-error',
      explanation: `${a} threw an Angular dependency-injection error while rendering - a service it needs is not provided on the path it is now loaded from.`,
      suggestion: 'A component moved into a lazy module loses providers that were only declared in the old parent module. Provide the service in the new module (or root).',
    };
  }
  if (/console error|pageerror/i.test(raw) && /threw/i.test(raw)) {
    return {
      kind: 'runtime-error',
      explanation: `${a} rendered but threw a JavaScript error while running.`,
      suggestion: 'Open the trace attached to this failure and read the browser console entry - the stack points at the component method that threw.',
    };
  }
  if (/Timed out .* waiting for .*toBeVisible|locator.*waitFor|expect\(locator\)\.toBeVisible/i.test(raw)) {
    return {
      kind: 'element-missing',
      explanation: `An element ${a} is supposed to render never appeared. Either the screen is broken, or the markup changed and this test is now pointing at something that no longer exists.`,
      suggestion: 'Open the screen by hand first. If it looks right, the selector is stale - update it. If it looks wrong, the screen is the bug.',
    };
  }
  if (/toBe\(|toHaveText|toContainText|toHaveURL|expect\(received\)/i.test(raw)) {
    return {
      kind: 'wrong-value',
      explanation: `${a} rendered, but showed a different value than expected. The screen works; something about what it displays changed.`,
      suggestion: 'Check whether the fixture data changed (scripts/fixtures/emulator-fixtures.js) or the display logic did. If the new value is correct, update the expectation.',
    };
  }
  if (/Test timeout of \d+ms exceeded/i.test(raw)) {
    return {
      kind: 'timeout',
      explanation: `${a} never finished loading inside the time limit - usually a Firestore query that never resolves, or a spinner that never clears.`,
      suggestion: 'Check for a missing Firestore composite index (the emulator logs these) or a subscription that never emits. Both hang forever rather than erroring.',
    };
  }
  return {
    kind: 'unknown',
    explanation: `${a} failed for a reason this dashboard could not classify.`,
    suggestion: 'Read the raw error below and the attached Playwright trace.',
  };
}

export default class DashboardReporter implements Reporter {
  private results = new Map<string, AreaResult>();
  private startedAt = 0;
  private outDir = '';

  onBegin(config: FullConfig, _suite: Suite): void {
    this.startedAt = Date.now();
    this.outDir = path.join(config.rootDir, 'results');
    // Every known area starts UNKNOWN. Anything still unknown at the end
    // had no test touch it, and the dashboard says so rather than
    // implying coverage that does not exist.
    for (const area of AREAS) {
      this.results.set(area.id, {
        id: area.id, title: area.title, owns: area.owns, layer: area.layer,
        dataCoveredBy: area.dataCoveredBy,
        status: 'unknown', passed: 0, failed: 0, flaky: 0, skipped: 0,
        durationMs: 0, failures: [],
      });
    }
  }

  // onTestEnd fires once PER ATTEMPT, so a retried test reports twice.
  // Counting attempts directly double-counts every failure and marks a
  // flaky test as failed AND flaky (turning an amber area red). So attempts
  // are only collected here, keyed by test; the verdict is taken from
  // test.outcome() in onEnd, which is Playwright's own final answer.
  private attempts = new Map<string, { test: TestCase; last: TestResult; totalMs: number }>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const prior = this.attempts.get(test.id);
    this.attempts.set(test.id, {
      test,
      // Keep the LAST failing attempt's error where there is one, so the
      // dashboard shows a real error rather than a retry's empty pass.
      last: result.status === 'passed' && prior ? prior.last : result,
      totalMs: (prior?.totalMs ?? 0) + result.duration,
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    for (const { test, last, totalMs } of this.attempts.values()) {
      const area = areaOf(test.titlePath());
      if (!area) continue;
      const bucket = this.results.get(area.id)!;
      bucket.durationMs += totalMs;

      const outcome = test.outcome();
      if (outcome === 'skipped') { bucket.skipped++; continue; }
      if (outcome === 'expected') { bucket.passed++; continue; }
      if (outcome === 'flaky') {
        // Passed only on a retry. Still costs someone a re-run, so amber -
        // never laundered into a pass.
        bucket.flaky++;
        continue;
      }

      bucket.failed++;
      const raw = [
        last.error?.message ?? '',
        last.error?.snippet ?? '',
      ].join('\n').replace(ANSI, '').trim();
      const auto = classify(raw, area);

      // A spec that already KNOWS why it fails can say so itself, via
      // annotations. The classifier reads the shape of a Playwright error
      // and can only ever produce a generic sentence; a test pinning a
      // diagnosed bug can name the file, the line and the fix. Annotations
      // win where present.
      // Playwright surfaces test-level annotations on BOTH the TestCase and
      // the per-attempt TestResult, and which one is populated has moved
      // between versions - read both rather than betting on one.
      const allAnnotations = [
        ...(test.annotations ?? []),
        ...((last as unknown as { annotations?: Array<{ type: string; description?: string }> })
          .annotations ?? []),
      ];
      const annotated = (t: string) =>
        allAnnotations.find((a) => a.type === t)?.description?.trim();
      const explanation = annotated('explanation') ?? auto.explanation;
      const suggestion = annotated('fix') ?? auto.suggestion;
      const kind = annotated('kind') ?? auto.kind;
      bucket.failures.push({
        test: test.titlePath().slice(1).join(' > '),
        file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
        line: test.location.line,
        raw: raw.slice(0, 2000),
        explanation, suggestion, kind,
        durationMs: totalMs,
      });
    }

    for (const bucket of this.results.values()) {
      if (bucket.failed > 0) bucket.status = 'red';
      else if (bucket.flaky > 0) bucket.status = 'yellow';
      else if (bucket.passed > 0) bucket.status = 'green';
      else if (bucket.skipped > 0) bucket.status = 'yellow';
      else bucket.status = 'unknown';
    }

    const areas = [...this.results.values()];
    const payload = {
      generatedAt: new Date().toISOString(),
      runStatus: result.status,
      durationMs: Date.now() - this.startedAt,
      totals: {
        areas: areas.length,
        green: areas.filter((a) => a.status === 'green').length,
        yellow: areas.filter((a) => a.status === 'yellow').length,
        red: areas.filter((a) => a.status === 'red').length,
        unknown: areas.filter((a) => a.status === 'unknown').length,
        passed: areas.reduce((n, a) => n + a.passed, 0),
        failed: areas.reduce((n, a) => n + a.failed, 0),
        flaky: areas.reduce((n, a) => n + a.flaky, 0),
        skipped: areas.reduce((n, a) => n + a.skipped, 0),
      },
      areas,
    };

    fs.mkdirSync(this.outDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.outDir, 'dashboard.json'),
      JSON.stringify(payload, null, 2),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(`\n[dashboard] wrote ${path.join(this.outDir, 'dashboard.json')} - ` +
      `${payload.totals.red} red, ${payload.totals.yellow} yellow, ` +
      `${payload.totals.green} green, ${payload.totals.unknown} untested`);
  }
}
