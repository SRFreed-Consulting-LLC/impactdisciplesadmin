#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// READ-ONLY. Answers one question: are people still subscribing to the
// newsletter, i.e. is queueSubscriptionConfirmation (and the free-ebook link
// inside it) still a live path worth protecting?
//
// Asked 2026-08-28 while deciding whether rotating the EBooks/M-7-Journal.pdf
// Storage download token would break anything real. The code path is live -
// web's subscribe form and campaign popup both POST subscribe_to_email_list,
// which queues the confirmation containing that URL - but "wired up" and
// "actually used" are different questions, and only the data answers the
// second one.
//
//   node scripts/check-newsletter-signups.js --project=prod
//   node scripts/check-newsletter-signups.js --project=dev --days=90

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const days = Number(args.days ?? 180);

/** The same five date shapes toMillis() exists for - see MIGRATION.md. */
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

(async () => {
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  console.log(`  project: ${projectId}`);

  const snap = await tenantCollection(db, "customers")
    .where("subscribedToNewsletter", "==", true).get();

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dated = [];
  let undatedCount = 0;

  for (const doc of snap.docs) {
    const ms = toMillis(doc.data().newsletterSubscribedDate);
    if (ms > 0) dated.push({ms, email: doc.data().email});
    else undatedCount++;
  }
  dated.sort((a, b) => b.ms - a.ms);

  const recent = dated.filter((d) => d.ms >= cutoff);

  console.log(`  newsletter subscribers total: ${snap.size}`);
  console.log(`    with a usable date: ${dated.length}   without: ${undatedCount}`);
  console.log(`  subscribed in the last ${days} days: ${recent.length}`);
  console.log("");
  console.log("  most recent 10 signups:");
  for (const d of dated.slice(0, 10)) {
    const when = new Date(d.ms).toISOString().slice(0, 10);
    const masked = (d.email ?? "").replace(/^(.).*(@.*)$/, "$1***$2");
    console.log(`    ${when}  ${masked}`);
  }
  if (!dated.length) {
    console.log("    (none carry a parseable newsletterSubscribedDate)");
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
