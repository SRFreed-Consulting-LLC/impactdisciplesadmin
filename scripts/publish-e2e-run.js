#!/usr/bin/env node
// Publishes ONE e2e suite's last-run status to the `e2e_runs` Firestore
// collection, which is what the admin app's Root-only E2E Dashboard reads.
//
// The catalog half of that dashboard (what each suite covers, which areas,
// which apps) is authored in the shared submodule at
// src/shared/testing/e2e-catalog.ts. This publishes only the RUNTIME half:
// when it last ran, and how it went.
//
// Document id is the suite id from that catalog, so keep them in step - a
// typo here writes a doc the dashboard never joins to and silently reports
// the suite as never run.
//
// Writes through the Admin SDK, which bypasses security rules; the rule for
// this collection denies all client writes on purpose (see firestore.rules).
//
// Usage:
//   node scripts/publish-e2e-run.js --suite=e2e-admin --project=dev \
//        --status=passed --passed=73 --failed=0 --flaky=1 --skipped=0 \
//        --duration-ms=476000
//
//   # or let it read a Playwright JSON report and work the numbers out:
//   node scripts/publish-e2e-run.js --suite=e2e-admin --project=dev \
//        --from-dashboard=e2e-admin/results/dashboard.json
//
// --dry-run prints the document instead of writing it.

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

/**
 * Parses --key=value / --flag arguments.
 * @param {string[]} argv process.argv.slice(2).
 * @return {Object<string,string|boolean>} Parsed args.
 */
function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

/**
 * Reads totals out of the admin dashboard reporter's json.
 * @param {string} file Path to dashboard.json.
 * @return {Object} Totals plus the per-area breakdown.
 */
function fromDashboard(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const t = data.totals || {};
  return {
    passed: t.passed ?? 0,
    failed: t.failed ?? 0,
    flaky: t.flaky ?? 0,
    skipped: t.skipped ?? 0,
    durationMs: data.durationMs ?? 0,
    finishedAt: data.generatedAt ? new Date(data.generatedAt) : new Date(),
    // Per-area rollup, so the dashboard can show WHICH area is unhappy
    // without the reader needing the whole report.
    areas: (data.areas || []).map((a) => ({
      id: a.id, title: a.title, status: a.status,
      passed: a.passed ?? 0, failed: a.failed ?? 0, flaky: a.flaky ?? 0,
    })),
  };
}

/**
 * A run is only "passed" when nothing failed AND nothing was flaky - a
 * flaky pass still cost someone a re-run, so it reports as unreliable
 * rather than being laundered into green.
 * @param {Object} r Run counts.
 * @return {string} passed | unreliable | failed.
 */
function deriveStatus(r) {
  if (r.failed > 0) return "failed";
  if (r.flaky > 0 || r.skipped > 0) return "unreliable";
  return "passed";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const suite = args.suite;
  if (!suite) {
    console.error("--suite=<id> is required (must match a suite id in shared/testing/e2e-catalog.ts)");
    process.exit(2);
  }

  let run;
  if (args["from-dashboard"]) {
    const file = path.resolve(process.cwd(), String(args["from-dashboard"]));
    if (!fs.existsSync(file)) {
      console.error(`No report at ${file}`);
      process.exit(2);
    }
    run = fromDashboard(file);
  } else {
    run = {
      passed: Number(args.passed ?? 0),
      failed: Number(args.failed ?? 0),
      flaky: Number(args.flaky ?? 0),
      skipped: Number(args.skipped ?? 0),
      durationMs: Number(args["duration-ms"] ?? 0),
      finishedAt: new Date(),
      areas: [],
    };
  }

  const doc = {
    suiteId: suite,
    status: args.status ? String(args.status) : deriveStatus(run),
    passed: run.passed,
    failed: run.failed,
    flaky: run.flaky,
    skipped: run.skipped,
    durationMs: run.durationMs,
    finishedAt: run.finishedAt,
    areas: run.areas,
    // Who/where, so a stale entry can be traced back to a machine rather
    // than being a mystery.
    runner: process.env.CI ? "ci" : (process.env.USERNAME || process.env.USER || "local"),
  };

  if (args["dry-run"]) {
    console.log(JSON.stringify({...doc, finishedAt: doc.finishedAt.toISOString()}, null, 2));
    return;
  }

  const projectId = resolveProjectId(String(args.project || "dev"));
  const db = getFirestoreFor(projectId);
  await db.collection("e2e_runs").doc(suite).set(doc, {merge: true});

  console.log(
    `published ${suite} -> ${projectId}: ${doc.status} ` +
    `(${doc.passed} passed, ${doc.failed} failed, ${doc.flaky} flaky, ${doc.skipped} skipped)`
  );
}

main().catch((err) => {
  // A publish failure must never fail the test run that produced it - the
  // tests already told you what you needed; this is only the record of it.
  console.error("publish-e2e-run failed (test results are unaffected):", err.message);
  process.exit(1);
});
