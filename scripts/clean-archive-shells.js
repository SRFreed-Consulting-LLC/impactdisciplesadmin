#!/usr/bin/env node
// ONE-OFF (2026-08-27): applies lib/email-chrome-clean.js to the ALREADY
// COMMITTED src/app/common/utils/email/archive-shells.ts, in place.
//
// Why this exists instead of just re-running extract-email-chrome.js: that
// script re-mines PROD's campaign archive, and campaigns have shipped since
// the file was generated - the five winning shells could come back as five
// different shells. Swapping the mastheads out from under the gallery is a
// deliberate decision, not a side effect of fixing merge tags. So the
// transform is applied to the fragments we already have, out of the SAME
// module the generator now uses, which is what keeps the two from drifting.
//
// Re-mining is still the right move eventually - run the generator when you
// actually want the newer chrome.
//
// Reads and writes ONE local file. Touches no project, needs no credentials,
// and is idempotent: a second run finds nothing left to change.
//
//   node scripts/clean-archive-shells.js            (dry run - prints a diff summary)
//   node scripts/clean-archive-shells.js --execute  (rewrites the file)
"use strict";

const fs = require("fs");
const path = require("path");
const { cleanChromeFragment, unresolvableTags } = require("./lib/email-chrome-clean");

const SHELLS_TS = path.join(
  __dirname, "..", "src", "app", "common", "utils", "email", "archive-shells.ts"
);

const execute = process.argv.slice(2).includes("--execute");

const source = fs.readFileSync(SHELLS_TS, "utf8");

// The file is generated, so its shape is known: a header comment, the
// interface, then one JSON array literal. Parsing the array rather than
// regexing the fields keeps the escaping honest - these fragments contain
// quotes, backticks and ${ sequences.
const declaration = "ARCHIVE_SHELLS: ArchiveShell[] =";
const declarationAt = source.indexOf(declaration);
if (declarationAt === -1) {
  throw new Error(`Could not find ${declaration} in ${SHELLS_TS}`);
}
const arrayStart = source.indexOf("[", declarationAt + declaration.length);
const arrayEnd = source.lastIndexOf("];");
const preamble = source.slice(0, arrayStart);
const shells = JSON.parse(source.slice(arrayStart, arrayEnd + 1));

let changed = 0;
const offenders = [];

for (const shell of shells) {
  for (const part of ["header", "footer"]) {
    const before = shell[part];
    const after = cleanChromeFragment(before);
    if (after !== before) {
      changed++;
    }
    shell[part] = after;
    offenders.push(...unresolvableTags(after).map((tag) => `${shell.id} ${part} ${tag}`));
    console.log(
      `  ${shell.id} ${part.padEnd(6)} ${String(before.length).padStart(6)} -> ` +
      `${String(after.length).padStart(6)} chars` +
      (after === before ? "   (unchanged)" : "")
    );
  }
}

if (offenders.length) {
  console.error("");
  console.error("  REFUSING TO WRITE - unresolvable merge tags survived:");
  offenders.forEach((o) => console.error("    " + o));
  process.exit(1);
}

console.log("");
console.log(`  ${changed} of ${shells.length * 2} fragments changed; no unresolvable tags remain.`);

if (!changed) {
  console.log("  Nothing to do - already clean.");
  return;
}

if (!execute) {
  console.log("  Dry run. Pass --execute to rewrite the file.");
  return;
}

// Re-emit exactly the way extract-email-chrome.js does, so a later regen
// produces a minimal diff against this file rather than a whitespace storm.
const rewritten =
  preamble +
  JSON.stringify(
    shells.map(({ id, name, description, header, footer }) =>
      ({ id, name, description, header, footer })), null, 2
  ) +
  ";\n";

fs.writeFileSync(SHELLS_TS, rewritten, "utf8");
console.log(`  wrote ${SHELLS_TS}`);
