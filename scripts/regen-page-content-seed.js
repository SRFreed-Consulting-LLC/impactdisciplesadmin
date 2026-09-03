#!/usr/bin/env node
/**
 * Regenerates scripts/page-content-seed-data.json from a live environment.
 *
 * WHY THIS EXISTS. The seed is the emulator's copy of every public page, and
 * it ROTTED SILENTLY. It was extracted while the section kit still had 14
 * archetypes; when those were replaced by the two-member kit on 2026-09-01
 * the file kept its `type: "copyMedia"` blocks, which the admin no longer
 * recognises. The result was not an error - the Page Manager rendered the
 * "no sections on this page" state, and thirteen e2e specs failed with
 * `app-page-stack` empty, none of them pointing at the seed.
 *
 * A fixture that mirrors a model has to be REGENERABLE, or it drifts the
 * next time the model changes. That is what this is for.
 *
 *   node scripts/regen-page-content-seed.js --project=prod          # dry run
 *   node scripts/regen-page-content-seed.js --project=prod --write
 *
 * Keeps the file's existing shape - { "<slug>": [ ...blocks ] } - because
 * cutover-page.js, merge-hero-split.js, hero-buttons-to-entries.js and
 * cta-buttons-to-entries.js all read and rewrite it in that shape. Only the
 * pages already in the file are refreshed: adding a page to the emulator
 * world is a deliberate act (it becomes a nav leaf and an e2e expectation),
 * not something a refresh should do behind your back. To add one on purpose:
 *
 *   node scripts/regen-page-content-seed.js --project=prod --add=home --write
 *
 * A page added here also needs a title in scripts/fixtures/emulator-fixtures.js
 * (PAGE_TITLES) - without one it is invisible to the admin. The seed script
 * throws rather than let that pass quietly.
 *
 * Needs `gcloud auth application-default login`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

const SEED = path.join(__dirname, "page-content-seed-data.json");
const WRITE = process.argv.includes("--write");
const arg = process.argv.find((a) => a.startsWith("--project="));
const PROJECT = resolveProjectId(arg ? arg.split("=")[1] : "");

/**
 * Entry point.
 * @return {Promise<void>} Resolves when the report (or write) is done.
 */
async function main() {
  const current = JSON.parse(fs.readFileSync(SEED, "utf8"));
  const slugs = Object.keys(current);
  const add = (process.argv.find((a) => a.startsWith("--add=")) || "")
    .split("=")[1];
  if (add && !slugs.includes(add)) {
    slugs.push(add);
    current[add] = [];
    console.log(`adding page "${add}"`);
  }
  console.log(`seed holds ${slugs.length} page(s)`);
  console.log(`source: ${PROJECT}\n`);

  const db = getFirestoreFor(PROJECT);
  const next = {};
  const missing = [];
  let changed = 0;

  for (const slug of slugs) {
    const snap = await db.doc(`${tenantPath("page_content")}/${slug}`).get();
    if (!snap.exists) {
      missing.push(slug);
      next[slug] = current[slug];
      continue;
    }
    const blocks = snap.data().blocks;
    if (!Array.isArray(blocks)) {
      missing.push(`${slug} (no blocks array)`);
      next[slug] = current[slug];
      continue;
    }
    next[slug] = blocks;

    const before = JSON.stringify(current[slug]);
    const after = JSON.stringify(blocks);
    const types = [...new Set(blocks.map((b) => b.type))].join(",");
    const oldTypes = [...new Set((current[slug] || []).map((b) => b.type))]
      .join(",");
    if (before !== after) {
      changed++;
      console.log(`${slug}`);
      console.log(`   was: ${(current[slug] || []).length} block(s)  [${oldTypes}]`);
      console.log(`   now: ${blocks.length} block(s)  [${types}]`);
    }
  }

  if (missing.length) {
    console.log(`\nNOT IN ${PROJECT}, left as-is: ${missing.join(", ")}`);
  }
  console.log(`\n${changed} page(s) would change.`);

  if (!WRITE) {
    console.log("DRY RUN - pass --write to update the seed file.");
    return;
  }
  fs.writeFileSync(SEED, JSON.stringify(next, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), SEED)}`);
  console.log("Re-run `npm run emu:seed` to load it into the emulator.");
}

main().catch((err) => {
  console.error("FAILED:", err.message || err);
  process.exitCode = 1;
});
