#!/usr/bin/env node
// One-off, 2026-09-03: three content edits to the /discipleship-library
// kit page (tenants/impactdisciples.com/page_content/discipleship-library),
// requested by the owner from the live page.
//
//   1. Both "Open the Library" buttons (hero + closing) get newTab: true.
//      The bespoke page hardcoded target="_blank"; the kit rebuild lost it
//      and the live site navigated AWAY from the marketing page for four
//      days. The web build already honours newTab (commit 9cb430e, verified
//      in prod's chunk-ZQ4WJBKM.js) - this is data, not a deploy.
//   2. The "Reading & Lessons" row's media: dictation.mp4 -> dictation.jpg.
//      The clip letterboxed into the phone-shaped media box with a grey
//      block under the phone. A still fits exactly.
//   3. The "Store" row's media: store.jpg -> store-v3.jpg. Recaptured from
//      the redesigned reader. NEW NAME because firebase.json serves assets
//      immutable for a year - see web/src/assets/reader/README.md. (v2 was
//      live for an hour and showed the products' "andd" typo; the data was
//      fixed by fix-products-andd-typo.js and the still retaken.)
//
// DEPLOY ORDER: the web HOSTING deploy carrying the two new files must land
// BEFORE this runs, or the page points at images that do not exist yet.
//
// Dry run by default; --apply writes. Idempotent - a second --apply reports
// "already correct" and writes nothing. Matches items by TITLE rather than
// array index so a reordered page cannot make it edit the wrong row.
//
//   node scripts/repoint-library-page-media.js --project=dev
//   node scripts/repoint-library-page-media.js --project=dev --apply
//   node scripts/repoint-library-page-media.js --project=prod --apply

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const APPLY = process.argv.includes("--apply");
const PAGE_ID = "discipleship-library";

const MEDIA = {
  "Reading & Lessons": "assets/reader/dictation.jpg",
  "Store": "assets/reader/store-v3.jpg",
};
const CTA_TITLE = "Open the Library";

async function main() {
  const projectId = resolveProjectId(arg("project"));
  const db = getFirestoreFor(projectId);
  const ref = db.collection(tenantPath("page_content")).doc(PAGE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`${ref.path} does not exist on ${projectId}`);
  }
  const data = snap.data();
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const changes = [];

  for (const block of blocks) {
    // 1. CTAs - every buttons piece in every column of every section.
    for (const col of block.columns || []) {
      for (const piece of col.pieces || []) {
        if (piece.kind !== "buttons") continue;
        for (const b of piece.buttons || []) {
          if (b.title !== CTA_TITLE) continue;
          if (b.newTab === true) {
            changes.push(`  = "${b.title}" (${block.key}) already newTab`);
          } else {
            b.newTab = true;
            changes.push(`  + "${b.title}" (${block.key}) -> newTab: true`);
          }
        }
      }
    }
    // 2 + 3. The feature list's media.
    if (block.type !== "list") continue;
    for (const item of block.items || []) {
      const want = MEDIA[item.title];
      if (!want) continue;
      const have = item.image && item.image.url;
      if (have === want) {
        changes.push(`  = "${item.title}" already ${want}`);
      } else {
        item.image = {...(item.image || {}), url: want};
        changes.push(`  + "${item.title}" ${have} -> ${want}`);
      }
    }
  }

  console.log(`${projectId} ${ref.path}`);
  for (const line of changes) console.log(line);
  const pending = changes.filter((c) => c.startsWith("  +")).length;
  if (pending === 0) {
    console.log("Nothing to write - already correct.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN - ${pending} change(s) NOT written. Re-run with --apply.`);
    return;
  }
  await ref.update({blocks});
  console.log(`\nWrote ${pending} change(s).`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
});
