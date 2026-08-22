#!/usr/bin/env node
'use strict';

// Collects unit-test results GROUPED BY FEATURE AREA into
// test-results/unit.json, for the Testing dashboard (2026-08-22).
//
// Why this and not a Karma reporter: the @angular/build:karma builder stops
// injecting jasmine as soon as a custom karmaConfig is supplied, so a
// hand-registered reporter takes the whole suite down with "describe is not
// defined". Tried, reverted, recorded here so nobody tries it twice.
//
// So this drives the suite the supported way instead - `ng test --include`
// once per area - and reads the totals it prints. Slower (one browser start
// per area, a few minutes all told), but it cannot break the suite, and
// "1422 tests passed" is not an answer to "is the campaign code healthy"
// anyway.
//
// Run from either app; --app decides which globs and which package.
//
//   node scripts/collect-unit-results.js --app=admin
//   node scripts/collect-unit-results.js --app=web

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ADMIN_ROOT = path.join(__dirname, '..');
const WEB_ROOT = path.join(ADMIN_ROOT, '..', 'impactdisciples - web');

// The globs must be MUTUALLY EXCLUSIVE. Each area is a separate ng test run,
// so an overlap double-counts and the board reports more tests than exist -
// which it briefly did, reading 1469 against a real 1422 because a campaign
// glob also caught the campaign models that Services & Models already owned.
// Campaign models therefore count as models; the manager owns the screens.
const AREAS = {
  admin: [
    { id: 'campaigns', title: 'Campaigns', globs: ['**/campaigns-manager/**/*.spec.ts'] },
    { id: 'store', title: 'Store & Checkout', globs: ['**/store-manager/**/*.spec.ts'] },
    { id: 'events', title: 'Events', globs: ['**/events-manager/**/*.spec.ts'] },
    { id: 'contacts', title: 'Contacts', globs: ['**/contacts-manager/**/*.spec.ts'] },
    { id: 'library', title: 'Library', globs: ['**/library-manager/**/*.spec.ts', '**/library/**/*.spec.ts'] },
    { id: 'email', title: 'Email & Templates', globs: ['**/tools-manager/**/*.spec.ts'] },
    { id: 'content', title: 'Content & Web', globs: ['**/content-manager/**/*.spec.ts', '**/web-manager/**/*.spec.ts'] },
    { id: 'platform', title: 'Services & Models', globs: ['**/common/**/*.spec.ts', '**/shared/**/*.spec.ts'] },
    // App wiring: the two whole-app smoke specs plus the nav config. They
    // belong to no feature and are the first thing to go red when a module
    // or provider is mis-registered, so they get named rather than lumped in.
    { id: 'wiring', title: 'App Wiring', globs: ['**/app/*.spec.ts', '**/core/**/*.spec.ts'] }
  ],
  web: [
    { id: 'store', title: 'Store & Checkout', globs: ['**/core/store/**/*.spec.ts'] },
    { id: 'events', title: 'Events', globs: ['**/core/pages/events/**/*.spec.ts'] },
    { id: 'platform', title: 'Services & Models', globs: ['**/common/**/*.spec.ts', '**/shared/**/*.spec.ts'] }
  ]
};

/** Karma's progress reporter line: "Executed 24 of 27 SUCCESS (0.03 secs...)". */
function parseTotals(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');

  const total = clean.match(/TOTAL:\s+(?:(\d+)\s+FAILED,\s+)?(\d+)\s+SUCCESS/);
  if (total) {
    return { passed: Number(total[2]), failed: Number(total[1] ?? 0) };
  }
  // A run that matched no specs prints neither line - that is 0, not a failure.
  if (/Executed 0 of 0/.test(clean)) {
    return { passed: 0, failed: 0 };
  }
  return null;
}

/** The describe › it lines Karma prints for each failure. */
function parseFailures(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  return [...clean.matchAll(/^.*?\)\s+(.+?)\s+FAILED$/gm)]
    .map((m) => m[1].trim())
    .slice(0, 10);
}

function main() {
  const args = process.argv.slice(2);
  const app = (args.find((a) => a.startsWith('--app=')) || '--app=admin').split('=')[1];
  const areas = AREAS[app];
  if (!areas) {
    console.error(`Unknown --app=${app}. Use admin or web.`);
    process.exit(1);
  }

  const root = app === 'admin' ? ADMIN_ROOT : WEB_ROOT;
  const startedAt = Date.now();
  const groups = [];

  console.log(`\nCollecting ${app} unit results by area (${areas.length} runs)\n`);

  for (const area of areas) {
    const include = area.globs.map((g) => `--include=${g}`).join(' ');
    const started = Date.now();
    let output = '';

    try {
      output = execSync(
        `npx ng test --watch=false --browsers=ChromeHeadless ${include}`,
        { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 600_000 }
      );
    } catch (err) {
      // A failing suite exits non-zero; its output is still what we want.
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    const totals = parseTotals(output);
    if (!totals) {
      console.log(`  ?       ${area.title.padEnd(22)} could not read a total - skipped`);
      continue;
    }

    const durationMs = Date.now() - started;
    groups.push({
      id: area.id,
      title: area.title,
      passed: totals.passed,
      failed: totals.failed,
      flaky: 0,
      skipped: 0,
      durationMs,
      failures: totals.failed > 0 ? parseFailures(output) : []
    });

    const mark = totals.failed > 0 ? 'FAIL' : 'ok';
    console.log(
      `  ${mark.padEnd(7)} ${area.title.padEnd(22)} ${totals.passed}p ${totals.failed}f  ` +
      `(${Math.round(durationMs / 1000)}s)`
    );
  }

  // Reconcile against ONE full run. Per-area globs can drift out of step with
  // the real suite - overlapping and double-counting, or missing a folder
  // nobody thought of - and a board that quietly reports the wrong number is
  // worse than one that admits it does not add up.
  let suiteTotal = null;
  try {
    const full = execSync(
      'npx ng test --watch=false --browsers=ChromeHeadless',
      { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 900_000 }
    );
    suiteTotal = parseTotals(full);
  } catch (err) {
    suiteTotal = parseTotals(`${err.stdout ?? ''}${err.stderr ?? ''}`);
  }

  const outFile = path.join(root, 'test-results', 'unit.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    // What one full run reports, so the dashboard can say when the areas do
    // not add up rather than presenting a wrong total as fact.
    suiteTotal,
    groups
  }, null, 2));

  const passed = groups.reduce((a, g) => a + g.passed, 0);
  const failed = groups.reduce((a, g) => a + g.failed, 0);
  console.log(`\n${passed} passed, ${failed} failed across ${groups.length} area(s).`);

  const areaCount = passed + failed;
  const runCount = suiteTotal ? suiteTotal.passed + suiteTotal.failed : null;
  if (runCount !== null && runCount !== areaCount) {
    console.log(
      `  NOTE: one full run reports ${runCount}. The area globs are off by ` +
      `${areaCount - runCount} - overlapping, or missing a folder.`
    );
  }

  console.log(`Written to ${outFile}\n`);
}

main();
