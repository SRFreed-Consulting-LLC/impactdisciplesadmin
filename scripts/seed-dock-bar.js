#!/usr/bin/env node
// Seeds `dock_bar/current` - the content of the public site's docking bar,
// which Content Manager > Docking Bar edits from here on.
//
// Exists because the bar shipped with its copy HARDCODED in the web app's
// LibraryDockComponent. Making it staff-editable means the component now
// renders nothing at all until that document exists, so without this the bar
// would simply vanish from the live site between the web deploy and someone
// opening the admin screen. Seeding the exact copy that was hardcoded keeps
// the site identical through the cutover.
//
// Idempotent by intent, and DELIBERATELY NOT an overwrite: if the document
// already exists it is left alone and reported, because by then it is staff's
// content and re-running a seed script must never quietly revert an edit.
// Pass --force only to deliberately reset the bar to the seed copy.
//
// Usage:
//   node scripts/seed-dock-bar.js --project=dev              # dry run
//   node scripts/seed-dock-bar.js --project=dev --execute
//   node scripts/seed-dock-bar.js --project=prod --execute
//   node scripts/seed-dock-bar.js --project=prod --execute --force

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const DOC_ID = "current";

// Verbatim what LibraryDockComponent's template hardcoded before this change.
const SEED = {
  isActive: true,
  label: "New",
  message: "The Impact Discipleship Library",
  note: "· free to join",
  cta1: {title: "See what it does", destination: "/discipleship-library"},
  cta2: {title: "Join a Group", destination: "/impact-groups"},
};

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
  const db = getFirestoreFor(projectId);
  const ref = db.collection("dock_bar").doc(DOC_ID);

  const existing = await ref.get();

  if (existing.exists && !args.force) {
    console.log(`[${projectId}] dock_bar/${DOC_ID} already exists - leaving it alone.`);
    console.log("Current content:");
    console.log(JSON.stringify(existing.data(), null, 2));
    console.log("\nPass --force to overwrite it with the seed copy.");
    return;
  }

  const action = existing.exists ? "OVERWRITE (--force)" : "CREATE";
  console.log(`[${projectId}] ${action} dock_bar/${DOC_ID}:`);
  console.log(JSON.stringify(SEED, null, 2));

  if (!args.execute) {
    console.log("\nDry run - pass --execute to write.");
    return;
  }

  await ref.set(SEED);
  console.log("\nWritten.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
