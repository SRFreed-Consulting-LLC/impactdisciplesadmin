'use strict';

// The one shape every test suite reports in, and the one the Testing
// dashboard reads back (Campaign Manager v3 test programme, 2026-08-22).
//
// Suites disagree about almost everything - Playwright knows areas, Karma
// knows spec files, node:test knows nothing but names - so each ingester
// normalizes into THIS and the dashboard never learns about any of them.
//
// Generalized from e2e-admin's existing dashboard.json (`areas` -> `groups`)
// so that file drops straight in, and so "unit tests grouped by function" and
// "E2E grouped by area" are the same rendering problem.
//
// One document per suite, id == suiteId, so publishing replaces rather than
// accumulates: the dashboard answers "what is true now", not "what happened
// in March". A run's own history lives in git and CI logs.

/** Suites the dashboard knows about, in the order it shows them. */
const SUITES = {
  'e2e-cross': { kind: 'e2e', app: 'shared', title: 'Cross-App E2E' },
  'e2e-admin': { kind: 'e2e', app: 'admin', title: 'Admin E2E' },
  'e2e-web': { kind: 'e2e', app: 'web', title: 'Storefront E2E' },
  'integration-rules': { kind: 'integration', app: 'shared', title: 'Firestore Rules' },
  'integration-functions': { kind: 'integration', app: 'functions', title: 'Cloud Functions' },
  'unit-admin': { kind: 'unit', app: 'admin', title: 'Admin Unit' },
  'unit-web': { kind: 'unit', app: 'web', title: 'Storefront Unit' }
};

const EMPTY_TOTALS = { passed: 0, failed: 0, flaky: 0, skipped: 0 };

/**
 * Red/yellow/green for one group.
 *
 * Flaky is YELLOW, never green: a test that passed on retry is not a test that
 * passes. A group with nothing in it is 'unknown' rather than green, so a
 * suite that silently stopped reporting cannot look healthy.
 */
function statusOf({ passed = 0, failed = 0, flaky = 0, skipped = 0 }) {
  if (failed > 0) return 'red';
  if (flaky > 0) return 'yellow';
  if (passed > 0) return 'green';
  if (skipped > 0) return 'yellow';
  return 'unknown';
}

function sumTotals(groups) {
  return groups.reduce((acc, group) => ({
    passed: acc.passed + (group.passed ?? 0),
    failed: acc.failed + (group.failed ?? 0),
    flaky: acc.flaky + (group.flaky ?? 0),
    skipped: acc.skipped + (group.skipped ?? 0)
  }), { ...EMPTY_TOTALS });
}

/**
 * Builds a publishable suite document.
 *
 * @param {string} suiteId One of SUITES.
 * @param {object[]} groups [{ id, title, owns?, passed, failed, flaky, skipped, durationMs?, failures? }]
 * @param {object} meta { generatedAt?, durationMs?, gitSha? }
 * @return {object} The document to publish.
 */
function buildSuiteDoc(suiteId, groups, meta = {}) {
  const known = SUITES[suiteId];
  if (!known) {
    throw new Error(`Unknown suiteId "${suiteId}" - add it to SUITES first.`);
  }

  const shaped = groups.map((group) => ({
    id: group.id,
    title: group.title ?? group.id,
    // What this group covers, in a sentence. Optional: only the E2E suites
    // have somewhere meaningful to say it.
    owns: group.owns ?? null,
    passed: group.passed ?? 0,
    failed: group.failed ?? 0,
    flaky: group.flaky ?? 0,
    skipped: group.skipped ?? 0,
    durationMs: group.durationMs ?? null,
    status: statusOf(group),
    // Kept short on purpose - this is a status board, not a log reader.
    failures: (group.failures ?? []).slice(0, 10)
  }));

  const totals = sumTotals(shaped);

  return {
    suiteId,
    kind: known.kind,
    app: known.app,
    title: known.title,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    durationMs: meta.durationMs ?? null,
    gitSha: meta.gitSha ?? null,
    runStatus: statusOf(totals),
    totals,
    groups: shaped
  };
}

module.exports = { SUITES, buildSuiteDoc, statusOf, sumTotals };
