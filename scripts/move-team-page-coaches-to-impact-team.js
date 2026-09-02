#!/usr/bin/env node
// One-time move for the Coaches -> Impact Team split - see MIGRATION.md's
// "Coaches split into Coaches + Impact Team" section for the full writeup.
// Every `coaches` doc with teamPageSortOrder set (the exact set the public
// "My Team" page currently renders - see coach.model.ts's own pre-split
// history) gets copied into a new `impact_team` doc, then deleted from
// `coaches`.
//
// Same document id is reused on the `impact_team` side (not a fresh
// auto-id) - CourseModel.coachIds (and the legacy AgendaItem.coaches
// fallback) reference coach ids as plain strings with no notion of which
// collection they point into (see impact-team.service.ts's own header
// comment on the combined picker); reusing the id is what keeps any
// existing course's coachIds resolving correctly after the move, with zero
// changes needed to any event/course document.
//
// This is a real move (delete from `coaches`), not a copy - the user
// explicitly chose this over the safer copy-only option, accepting that
// impactdisciples-web (a separate repo, not editable from here) needs its
// own "My Team" page query updated to read `impact_team` instead of
// `coaches` for these people to reappear there. See this script's own
// final console output for exactly which ids moved.
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default
// (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/move-team-page-coaches-to-impact-team.js --project=dev
//   node scripts/move-team-page-coaches-to-impact-team.js --project=dev --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");
const { tenantCollection } = require("./lib/tenancy");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const coachesSnap = await tenantCollection(db, "coaches").get();
  const allCoaches = coachesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const toMove = allCoaches.filter((c) => typeof c.teamPageSortOrder === "number");
  const staying = allCoaches.length - toMove.length;

  console.log(`${allCoaches.length} total coaches (${toMove.length} have teamPageSortOrder set -> moving to Impact Team, ${staying} stay as breakout-only Coaches)\n`);

  if (toMove.length === 0) {
    console.log("Nothing to move.");
    return;
  }

  toMove.forEach((c) => {
    console.log(`  ${c.id}  ${c.firstName || ""} ${c.lastName || ""}  (teamPageSortOrder=${c.teamPageSortOrder})`);
  });
  console.log("");

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  for (const coach of toMove) {
    const { id, teamPageSortOrder, ...rest } = coach;

    const impactTeamDoc = {
      ...rest,
      sortOrder: teamPageSortOrder,
      fullname: `${rest.firstName || ""} ${rest.lastName || ""}`.trim()
    };

    batch.set(tenantCollection(db, "impact_team").doc(id), impactTeamDoc);
    batch.delete(tenantCollection(db, "coaches").doc(id));
    opsInBatch += 2;

    if (opsInBatch >= 400) {
      await batch.commit();
      batchesFlushed++;
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) {
    await batch.commit();
    batchesFlushed++;
  }

  console.log(`Done - moved ${toMove.length} record(s), ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
