#!/usr/bin/env node
// Mailchimp sunset, step "audience" (2026-08-20): the LAST thing Mailchimp
// did for us was hold the newsletter audience the sync kept pushing
// customers into. Before the sync is removed and the account closed, the
// audience's truth is folded into `customers` (the app's own subscriber
// store - subscribedToNewsletter / subscribedToPrayerTeam flags) so that
// nobody who gets the newsletter today stops getting it, and nobody who
// opted out in Mailchimp starts getting it from our engine.
//
// Three buckets, computed against a full audience export (members with
// status, merge_fields, tags, timestamps - scripts/output/
// mailchimp-audience-export-<project>.json, written by --fetch):
//   IMPORT   subscribed in Mailchimp, no `customers` doc  -> create one
//            (firstName/lastName from merge fields, subscribedToNewsletter
//            true, newsletterSubscribedDate = Mailchimp opt-in time; the
//            "Impact Prayer Team" tag also sets subscribedToPrayerTeam)
//   UNFLAG   `customers` says subscribedToNewsletter but Mailchimp says
//            unsubscribed or cleaned (bounced) -> flag false. Their opt-out
//            is honored; the subscribe date is left as history (the app's
//            own unsubscribe path does the same).
//   FLAG     subscribed in Mailchimp, has a `customers` doc, but the flag
//            is not true -> flag true (behavior-preserving: they receive
//            the newsletter today; every send carries our unsubscribe link).
// Customers docs are found by exact lower-cased email match. Idempotent;
// dry run by default.
//
// Usage (PowerShell):
//   $env:MAILCHIMP_API_KEY = (firebase functions:secrets:access MAILCHIMP_API_KEY --project <project>)
//   node scripts/archive/mailchimp-sunset/reconcile-mailchimp-audience.js --project=prod --fetch      # export + dry run
//   node scripts/archive/mailchimp-sunset/reconcile-mailchimp-audience.js --project=prod --execute    # apply from the export

const fs = require("fs");
const path = require("path");
const {admin, resolveProjectId, getFirestoreFor} = require("../../lib/firestore-admin");

const LIST_ID = "4343bb4ff6";
const PRAYER_TAG = "Impact Prayer Team";

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

/**
 * Pulls the whole audience from the Mailchimp API.
 * @return {Promise<object[]>} Members.
 */
async function fetchAudience() {
  const key = (process.env.MAILCHIMP_API_KEY || "").trim();
  if (!key.includes("-")) throw new Error("Set MAILCHIMP_API_KEY (xxxx-usNN) to --fetch.");
  const dc = key.split("-").pop();
  const auth = "Basic " + Buffer.from("anystring:" + key).toString("base64");
  const members = [];
  let offset = 0;
  for (;;) {
    const url = `https://${dc}.api.mailchimp.com/3.0/lists/${LIST_ID}/members?count=1000&offset=${offset}` +
      "&fields=members.email_address,members.status,members.tags,members.merge_fields," +
      "members.timestamp_opt,members.timestamp_signup,members.last_changed,total_items";
    const response = await fetch(url, {headers: {"Authorization": auth}});
    const data = await response.json();
    if (!response.ok) throw new Error(`Mailchimp ${response.status}: ${data?.detail ?? data?.title}`);
    members.push(...(data.members ?? []));
    offset += 1000;
    if (offset >= (data.total_items ?? 0)) break;
  }
  return members;
}

/**
 * Main.
 */
async function main() {
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const exportPath = path.join(__dirname, "..", "..", "output", `mailchimp-audience-export-${projectId}.json`);
  const db = getFirestoreFor(projectId);
  console.log(`Project: ${projectId}  mode: ${execute ? "EXECUTE" : "dry run"}`);

  let members;
  if (args.fetch || !fs.existsSync(exportPath)) {
    members = await fetchAudience();
    fs.mkdirSync(path.dirname(exportPath), {recursive: true});
    fs.writeFileSync(exportPath, JSON.stringify({exportedAt: new Date().toISOString(), listId: LIST_ID, members}, null, 1));
    console.log(`Exported ${members.length} audience members -> ${exportPath}`);
  } else {
    const parsed = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    members = parsed.members ?? parsed;
    console.log(`Using export ${exportPath} (${members.length} members, exported ${parsed.exportedAt ?? "?"})`);
  }

  const customersSnap = await db.collection("customers").get();
  const byEmail = new Map();
  for (const doc of customersSnap.docs) {
    const email = String(doc.data().email ?? "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, doc);
  }
  console.log(`customers: ${customersSnap.size} (${byEmail.size} distinct emails)`);

  const plan = {import: [], unflag: [], flag: []};
  for (const m of members) {
    const email = String(m.email_address ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    const doc = byEmail.get(email);
    const tags = (m.tags ?? []).map((t) => t.name);
    if (m.status === "subscribed") {
      if (!doc) plan.import.push({email, m, tags});
      else if (doc.data().subscribedToNewsletter !== true) plan.flag.push({email, doc, m});
    } else if ((m.status === "unsubscribed" || m.status === "cleaned") && doc &&
      doc.data().subscribedToNewsletter === true) {
      plan.unflag.push({email, doc, m});
    }
  }
  const prayerImports = plan.import.filter((p) => p.tags.includes(PRAYER_TAG)).length;
  console.log(`IMPORT ${plan.import.length} (of which ${prayerImports} also prayer team) | ` +
    `UNFLAG ${plan.unflag.length} (${plan.unflag.filter((p) => p.m.status === "cleaned").length} bounced) | ` +
    `FLAG ${plan.flag.length}`);
  console.log("  import sample:", plan.import.slice(0, 3).map((p) => `${p.email} (${p.m.merge_fields?.FNAME ?? ""} ${p.m.merge_fields?.LNAME ?? ""})`.trim()));
  console.log("  unflag sample:", plan.unflag.slice(0, 3).map((p) => `${p.email} [${p.m.status}]`));
  console.log("  flag sample:  ", plan.flag.slice(0, 3).map((p) => p.email));
  if (!execute) {
    console.log("\nDry run done - rerun with --execute to apply.");
    return;
  }

  const now = admin.firestore.Timestamp.now();
  const optTime = (m) => {
    const t = m.timestamp_opt || m.timestamp_signup || m.last_changed;
    const d = t ? new Date(t) : null;
    return d && !isNaN(d.getTime()) ? admin.firestore.Timestamp.fromDate(d) : now;
  };
  let imported = 0;
  for (const p of plan.import) {
    const data = {
      firstName: String(p.m.merge_fields?.FNAME ?? "").trim().slice(0, 100),
      lastName: String(p.m.merge_fields?.LNAME ?? "").trim().slice(0, 100),
      email: p.email,
      role: "Customer",
      notes: [],
      pendingChanges: [],
      subscribedToNewsletter: true,
      newsletterSubscribedDate: optTime(p.m),
      source: "mailchimp-audience-reconcile",
    };
    if (p.tags.includes(PRAYER_TAG)) {
      data.subscribedToPrayerTeam = true;
      data.prayerTeamSubscribedDate = optTime(p.m);
    }
    await db.collection("customers").add(data);
    imported++;
    if (imported % 100 === 0) console.log(`  imported ${imported}/${plan.import.length}...`);
  }
  let unflagged = 0;
  for (const p of plan.unflag) {
    await p.doc.ref.update({subscribedToNewsletter: false});
    unflagged++;
  }
  let flagged = 0;
  for (const p of plan.flag) {
    const update = {subscribedToNewsletter: true};
    if (!p.doc.data().newsletterSubscribedDate) update.newsletterSubscribedDate = optTime(p.m);
    await p.doc.ref.update(update);
    flagged++;
  }
  console.log(`\nDone: imported ${imported}, unflagged ${unflagged}, flagged ${flagged}.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
