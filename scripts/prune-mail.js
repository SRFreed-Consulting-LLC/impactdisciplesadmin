// Deletes spent delivery receipts from the `mail` collection.
//
//   node scripts/prune-mail.js --project=prod --before=2026-06-01
//   node scripts/prune-mail.js --project=prod --before=2026-06-01 --execute
//
// DRY RUN unless --execute. Backs every document up to a JSON file before
// deleting anything.
//
// WHY THIS EXISTS. `mail` is the Trigger Email extension's queue: the app
// writes a document, the extension sends it and stamps `delivery`, and then
// nothing ever clears it. On 2026-09-01 prod held 7,792 documents - each
// carrying its full message body - with the oldest delivered in September
// 2024. It was the only collection in either project growing without limit.
//
// WHAT IT WILL NOT TOUCH:
//   - anything without `delivery.endTime`, which is the extension's own
//     stamp that it has finished with a document. A queued or in-flight
//     message has no endTime and is therefore invisible to the query;
//   - anything whose delivery did not SUCCEED, so a failed send is still
//     there to look at;
//   - anything newer than --before, which has no default. There is no safe
//     default for "how much history to throw away".
//
// The mail itself is not the record of anything: campaign sends are tracked
// in `campaign_emails` and `campaign_events`, and transactional receipts are
// in `purchases`. This is the delivery log, not the history.

const fs = require("fs");
const path = require("path");
const {getFirestoreFor, resolveProjectId, firestore} =
  require("./lib/firestore-admin");

const {Timestamp} = firestore;

/** Firestore's own per-commit ceiling is 500; this leaves room. */
const BATCH = 400;

/**
 * Reads --key=value from argv.
 * @param {string} key Flag name without dashes.
 * @return {string|undefined} The value, if given.
 */
function arg(key) {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

/** @return {Promise<void>} */
async function main() {
  const execute = process.argv.includes("--execute");
  const projectId = resolveProjectId(arg("project"));
  const before = arg("before");

  if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    console.error("Missing --before=YYYY-MM-DD. There is no default - it " +
      "decides how much history is thrown away.");
    process.exit(1);
  }

  const cutoff = Timestamp.fromDate(new Date(`${before}T00:00:00Z`));
  const db = getFirestoreFor(projectId);

  const total = (await db.collection("mail").count().get()).data().count;
  const doomed = await db.collection("mail")
    .where("delivery.endTime", "<", cutoff)
    .get();

  const sent = doomed.docs.filter((d) => {
    const s = d.data().delivery && d.data().delivery.state;
    return s === "SUCCESS";
  });
  const notSent = doomed.size - sent.length;

  console.log(`${projectId} ${execute ? "(EXECUTING)" : "(dry run)"}`);
  console.log(`  mail holds            ${String(total).padStart(6)} documents`);
  console.log(`  delivered before ${before}  ${String(doomed.size).padStart(6)}`);
  console.log(`  of those, SUCCESS     ${String(sent.length).padStart(6)}  <- what goes`);
  console.log(`  of those, not SUCCESS ${String(notSent).padStart(6)}  <- kept, so a ` +
    "failure is still there to look at");
  console.log(`  remaining afterwards  ${String(total - sent.length).padStart(6)}`);

  if (!sent.length) {
    console.log("\nNothing to do.");
    return;
  }
  if (!execute) {
    console.log("\nDry run - re-run with --execute to back up and delete.");
    return;
  }

  const out = path.join(__dirname, "backups",
    `mail-pruned-${projectId}-before-${before}.json`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(
    sent.map((d) => ({id: d.id, data: d.data()})), null, 1));
  console.log(`\n  backed up to ${path.relative(process.cwd(), out)} ` +
    `(${(fs.statSync(out).size / 1048576).toFixed(1)}MB)`);

  for (let i = 0; i < sent.length; i += BATCH) {
    const batch = db.batch();
    sent.slice(i, i + BATCH).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`  deleted ${Math.min(i + BATCH, sent.length)}/${sent.length}`);
  }

  const after = (await db.collection("mail").count().get()).data().count;
  console.log(`\n  mail now holds ${after} documents ` +
    `(expected ${total - sent.length}).`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
