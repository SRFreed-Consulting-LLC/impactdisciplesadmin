#!/usr/bin/env node
/*
 * Coverage ratchet (Phase 0 of the test-coverage plan - see CLAUDE.md > Testing).
 *
 * Runs the unit suite with coverage, then enforces that NO metric has dropped
 * below the committed baseline (coverage-baseline.json). Coverage can only go
 * up. It also surfaces the HONEST file-level number - how many of the app's
 * source files any test actually reaches - because the headline statement %%
 * is only measured across the files tests import, not the whole app.
 *
 *   node scripts/check-coverage.js            run + check (used by CI)
 *   node scripts/check-coverage.js --update   run + write the numbers as the new baseline
 *
 * Browser defaults to ChromeHeadless; override with COVERAGE_BROWSER (CI can
 * set e.g. ChromeHeadlessNoSandbox once a launcher exists, or pass a flag).
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'coverage-baseline.json');
const COVERAGE_HTML_DIR = path.join(ROOT, 'coverage', 'impactdisciplesadmin');
const SRC = path.join(ROOT, 'src');
const UPDATE = process.argv.includes('--update');
const BROWSER = process.env.COVERAGE_BROWSER || 'ChromeHeadless';

/** Recursively count .ts source files (excludes specs and type decls). */
function countSourceFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      n += countSourceFiles(full);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      n += 1;
    }
  }
  return n;
}

/** Count the per-file HTML pages Istanbul emitted - one per instrumented file. */
function countInstrumentedFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      n += countInstrumentedFiles(full);
    } else if (entry.name.endsWith('.ts.html')) {
      n += 1;
    }
  }
  return n;
}

function parseSummary(stdout) {
  // Matches the karma text-summary block, e.g.
  //   Statements   : 54.62% ( 360/659 )
  const grab = (label) => {
    const m = stdout.match(
      new RegExp(`${label}\\s*:\\s*([\\d.]+)%\\s*\\(\\s*(\\d+)/(\\d+)\\s*\\)`),
    );
    return m ? { pct: parseFloat(m[1]), covered: +m[2], total: +m[3] } : null;
  };
  return {
    statements: grab('Statements'),
    branches: grab('Branches'),
    functions: grab('Functions'),
    lines: grab('Lines'),
  };
}

console.log(`\n> running unit suite with coverage (browser: ${BROWSER})...\n`);
let stdout;
try {
  stdout = execSync(
    `npx ng test --code-coverage --watch=false --browsers=${BROWSER}`,
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
} catch (err) {
  // A non-zero exit means a spec FAILED - that's a gate failure in its own
  // right (CI didn't run tests at all before this). Surface and stop.
  if (err.stdout) process.stdout.write(err.stdout.toString());
  console.error('\n✗ Unit tests failed - coverage not checked.\n');
  process.exit(1);
}

const s = parseSummary(stdout);
if (!s.statements || !s.branches || !s.functions || !s.lines) {
  console.error('\n✗ Could not parse the coverage summary from test output.');
  console.error('  (Expected a "Statements : NN% ( x/y )" block - reporter output may have changed.)\n');
  process.exit(1);
}

const filesCovered = countInstrumentedFiles(COVERAGE_HTML_DIR);
const filesTotal = countSourceFiles(SRC);
const filePct = filesTotal ? (filesCovered / filesTotal) * 100 : 0;

// The ratchet gates on ABSOLUTE covered counts + files reached, not
// percentages. Percentages can legitimately DIP when you start testing a big
// mostly-untested file (its whole body enters the denominator while your first
// test covers a slice) - yet that's real progress: more code and more files
// are now tested. Absolute covered counts only rise when tests are added and
// only fall when a test/file is removed, which is the regression we want to
// catch. Percentages are reported for context.
const current = {
  coveredStatements: s.statements.covered,
  coveredBranches: s.branches.covered,
  coveredFunctions: s.functions.covered,
  coveredLines: s.lines.covered,
  filesCovered,
  // Informational only (not gated):
  pct: {
    statements: s.statements.pct,
    branches: s.branches.pct,
    functions: s.functions.pct,
    lines: s.lines.pct,
  },
};

console.log('\n=============== Coverage ratchet ===============');
console.log('Of the files tests reach:');
for (const k of ['statements', 'branches', 'functions', 'lines']) {
  console.log(`  ${k.padEnd(11)} ${String(s[k].pct + '%').padStart(7)}  (${s[k].covered}/${s[k].total})`);
}
console.log('\nHonest, app-wide file reach:');
console.log(`  ${filesCovered} of ${filesTotal} source files are touched by ANY test  (${filePct.toFixed(1)}%)`);
console.log(`  ${filesTotal - filesCovered} files have zero test reaching them.`);
console.log('===============================================\n');

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`✓ Baseline updated -> coverage-baseline.json\n`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('✗ No coverage-baseline.json found. Seed it once with:');
  console.error('    npm run coverage:baseline\n');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const GATED = [
  ['coveredStatements', 'covered statements'],
  ['coveredBranches', 'covered branches'],
  ['coveredFunctions', 'covered functions'],
  ['coveredLines', 'covered lines'],
  ['filesCovered', 'files reached'],
];
const regressions = [];
for (const [key, label] of GATED) {
  // Integer counts - a strict drop means a test or a tested file was removed.
  if (current[key] < baseline[key]) {
    regressions.push(`${label}: ${current[key]} < baseline ${baseline[key]}`);
  }
}

if (regressions.length) {
  console.error('✗ Coverage regressed - the ratchet only allows it to go UP:');
  for (const r of regressions) console.error(`    - ${r}`);
  console.error('\n  A count dropped, so a test or a tested code path was removed. Restore it,');
  console.error('  or if the drop is intentional (e.g. dead code deleted), re-baseline with:');
  console.error('    npm run coverage:baseline\n');
  process.exit(1);
}

const improved = GATED.some(([key]) => current[key] > baseline[key]);

console.log(`✓ Coverage held or improved vs baseline.`);
if (improved) {
  console.log('  It went UP - lock the gain in with:  npm run coverage:baseline\n');
} else {
  console.log('');
}
process.exit(0);
