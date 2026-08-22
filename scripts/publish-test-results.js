#!/usr/bin/env node
'use strict';

// Publishes whatever test results are on disk to the `test_runs` collection,
// which the admin app's Testing dashboard reads (2026-08-22).
//
// Ingests each suite's NATIVE output rather than asking suites to agree:
//   e2e-admin  - its existing dashboard.json (already the right shape)
//   e2e-cross  - Playwright json
//   e2e-web    - Playwright json, from the web repo
//   rules      - node:test json stream
//   functions  - node:test json stream
//   unit       - the in-repo Karma json reporter, one file per app
//
// Tolerant by design: it publishes what it finds and reports what it did not,
// so a partial run still updates the board instead of failing outright. A
// suite nobody has run since the last publish keeps its previous document -
// which is why every document carries generatedAt, and why the dashboard shows
// how old each one is rather than implying it is current.
//
//   node scripts/publish-test-results.js --project=dev
//   node scripts/publish-test-results.js --project=dev --execute
//
// Dry-run by default like every script here.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');
const { buildSuiteDoc } = require('./lib/test-results');

const ADMIN_ROOT = path.join(__dirname, '..');
const WEB_ROOT = path.join(ADMIN_ROOT, '..', 'impactdisciples - web');

function readJson(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch (err) {
    console.log(`  (unreadable) ${file}: ${err.message}`);
    return null;
  }
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: ADMIN_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ingesters

/** e2e-admin already reports the right shape - `areas` become groups. */
function ingestAdminE2e() {
  const data = readJson(path.join(ADMIN_ROOT, 'e2e-admin', 'results', 'dashboard.json'));
  if (!data) return null;

  return buildSuiteDoc('e2e-admin', (data.areas ?? []).map((area) => ({
    id: area.id,
    title: area.title,
    owns: area.owns,
    passed: area.passed,
    failed: area.failed,
    flaky: area.flaky,
    skipped: area.skipped,
    durationMs: area.durationMs,
    failures: (area.failures ?? []).map((f) => (typeof f === 'string' ? f : f.title ?? ''))
  })), { generatedAt: data.generatedAt, durationMs: data.durationMs, gitSha: gitSha() });
}

/**
 * Playwright's json reporter, grouped by SPEC FILE.
 *
 * A spec file is the closest thing Playwright has to "an area" once a suite
 * stops carrying its own annotations, and it is how someone reading a red
 * board finds the failure.
 */
function ingestPlaywright(suiteId, file) {
  const data = readJson(file);
  if (!data) return null;

  const groups = new Map();

  const walk = (suite, fileName) => {
    const name = suite.file ?? fileName;
    for (const spec of suite.specs ?? []) {
      const key = path.basename(name ?? 'unknown', '.spec.ts');
      const group = groups.get(key) ?? {
        id: key, title: key, passed: 0, failed: 0, flaky: 0, skipped: 0,
        durationMs: 0, failures: []
      };

      for (const test of spec.tests ?? []) {
        const status = test.status ?? test.results?.[0]?.status;
        const duration = (test.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0);
        group.durationMs += duration;

        if (status === 'flaky') group.flaky += 1;
        else if (status === 'skipped') group.skipped += 1;
        else if (status === 'expected' || status === 'passed') group.passed += 1;
        else {
          group.failed += 1;
          group.failures.push(spec.title);
        }
      }
      groups.set(key, group);
    }
    for (const child of suite.suites ?? []) walk(child, name);
  };

  for (const suite of data.suites ?? []) walk(suite, suite.file);

  return buildSuiteDoc(suiteId, [...groups.values()], {
    generatedAt: data.stats?.startTime,
    durationMs: data.stats?.duration,
    gitSha: gitSha()
  });
}

/**
 * node:test's json stream (newline-delimited events).
 *
 * Grouped by the top-level describe/file, which for these suites is the
 * meaningful unit - "rules" and "functions" are each one area of risk.
 */
function ingestNodeTest(suiteId, file, groupTitle) {
  if (!fs.existsSync(file)) return null;

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // Only leaf tests carry a name and a pass/fail; suites report separately
    // and would double-count.
    if (event.type === 'test:pass') {
      if (event.data?.details?.type === 'suite') continue;
      if (event.data?.skip) skipped += 1;
      else passed += 1;
    } else if (event.type === 'test:fail') {
      if (event.data?.details?.type === 'suite') continue;
      failed += 1;
      failures.push(event.data?.name ?? 'unnamed');
    }
  }

  return buildSuiteDoc(suiteId, [{
    id: suiteId, title: groupTitle, passed, failed, skipped, flaky: 0, failures
  }], { gitSha: gitSha() });
}

/** The in-repo Karma reporter already writes the group shape. */
function ingestKarma(suiteId, file) {
  const data = readJson(file);
  if (!data) return null;
  return buildSuiteDoc(suiteId, data.groups ?? [], {
    generatedAt: data.generatedAt, durationMs: data.durationMs, gitSha: gitSha()
  });
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}\n`);

  const docs = [
    ingestAdminE2e(),
    ingestPlaywright('e2e-cross', path.join(ADMIN_ROOT, 'test-results', 'cross.json')),
    ingestPlaywright('e2e-web', path.join(WEB_ROOT, 'test-results', 'web-e2e.json')),
    ingestNodeTest('integration-rules',
      path.join(ADMIN_ROOT, 'test-results', 'rules.json'), 'Security Rules'),
    ingestNodeTest('integration-functions',
      path.join(ADMIN_ROOT, 'test-results', 'functions.json'), 'Cloud Functions'),
    ingestKarma('unit-admin', path.join(ADMIN_ROOT, 'test-results', 'unit.json')),
    ingestKarma('unit-web', path.join(WEB_ROOT, 'test-results', 'unit.json'))
  ].filter(Boolean);

  if (docs.length === 0) {
    console.log('No results found. Run a suite first.\n');
    return;
  }

  const db = getFirestoreFor(projectId);

  for (const doc of docs) {
    const { passed, failed, flaky, skipped } = doc.totals;
    console.log(
      `  ${doc.runStatus.toUpperCase().padEnd(7)} ${doc.suiteId.padEnd(22)}` +
      `${doc.groups.length} group(s)  ${passed}p ${failed}f ${flaky}fl ${skipped}s`
    );
    if (execute) {
      await db.collection('test_runs').doc(doc.suiteId).set(doc);
    }
  }

  console.log(
    `\n${docs.length} suite(s) ${execute ? 'published.' : 'would be published. Re-run with --execute.'}\n`
  );
}

main().catch((err) => {
  console.error('publish-test-results failed:', err);
  process.exit(1);
});
