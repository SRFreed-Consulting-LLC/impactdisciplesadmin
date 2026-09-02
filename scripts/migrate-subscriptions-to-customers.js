#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time backfill for the `subscriptions` -> `customers` flag migration -
// see MIGRATION.md's "Newsletter/Prayer Team subscribers: collection merged
// into `customers` flags" section for the full writeup. Mirrors
// subscribe_to_email_list's own merge behavior (functions/src/
// subscriptions.functions.ts) for every existing doc in the old
// `subscriptions` collection: match a `customers` doc by (trimmed,
// lowercased) email, create one if none exists, and set that type's
// flag/date - never overwriting name/email already on an existing
// customer, same as the live endpoint.
//
// Unlike the live endpoint (one subscribe -> one Firestore round trip),
// this walks every subscription doc against an in-memory map keyed by
// email first, then writes each customer once at the end - if the same
// email+type appears more than once (shouldn't normally happen, see
// SubscriptionService's own dedupe logic, but a migration script should be
// defensive), the LATEST `date` wins.
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default
// (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/migrate-subscriptions-to-customers.js --project=dev
//   node scripts/migrate-subscriptions-to-customers.js --project=dev --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

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

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

const FIELDS_BY_TYPE = {
  newsletter: { flagField: "subscribedToNewsletter", dateField: "newsletterSubscribedDate" },
  prayer: { flagField: "subscribedToPrayerTeam", dateField: "prayerTeamSubscribedDate" }
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  // ---- Load existing customers, keyed by lowercased email ----
  const existingSnap = await tenantCollection(db, "customers").get();
  const byEmail = new Map();
  const duplicateEmails = new Map();

  existingSnap.docs.forEach((doc) => {
    const data = doc.data();
    const email = (data.email || "").trim().toLowerCase();
    if (!email) return;
    if (byEmail.has(email)) {
      const list = duplicateEmails.get(email) || [byEmail.get(email).__id];
      list.push(doc.id);
      duplicateEmails.set(email, list);
      return; // keep whichever we saw first - this script only sets flags, doesn't merge duplicates
    }
    byEmail.set(email, { ...data, __id: doc.id, __existed: true });
  });

  if (duplicateEmails.size > 0) {
    console.log(`⚠ ${duplicateEmails.size} email(s) already have MORE THAN ONE customer record in Firestore:`);
    for (const [email, ids] of duplicateEmails) {
      console.log(`  ${email}: ${ids.join(", ")} (kept ${byEmail.get(email).__id}, others ignored by this script)`);
    }
    console.log("  These need manual cleanup separately (see scripts/resolve-ambiguous-customers.js) - not handled here.\n");
  }

  // ---- Load subscriptions, oldest first (so a later duplicate wins) ----
  const subsSnap = await db.collection("subscriptions").get();
  const allSubs = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let skippedNoEmail = 0;
  let skippedBadType = 0;
  const subs = allSubs
    .filter((s) => {
      const email = (s.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        skippedNoEmail++;
        return false;
      }
      if (!FIELDS_BY_TYPE[s.type]) {
        skippedBadType++;
        return false;
      }
      return true;
    })
    .sort((a, b) => toMillis(a.date) - toMillis(b.date));

  console.log(`${allSubs.length} total subscriptions (${skippedNoEmail} skipped - no/invalid email, ${skippedBadType} skipped - unknown type), processing ${subs.length}\n`);

  let created = 0;
  let flaggedExisting = 0;
  let alreadySet = 0;
  const perType = { newsletter: 0, prayer: 0 };

  for (const sub of subs) {
    const email = sub.email.trim().toLowerCase();
    const { flagField, dateField } = FIELDS_BY_TYPE[sub.type];

    let customer = byEmail.get(email);
    if (!customer) {
      customer = {
        firstName: sub.firstName || "",
        lastName: sub.lastName || "",
        email,
        role: "Customer",
        notes: [],
        pendingChanges: [],
        __new: true
      };
      byEmail.set(email, customer);
      created++;
    }

    if (customer[flagField] === true) {
      // Already flagged (e.g. a later subscription of the same type, or the
      // live endpoint already ran for this person since this migration was
      // written) - later `date` still wins since subs are sorted oldest-first.
      alreadySet++;
    } else if (!customer.__new) {
      flaggedExisting++;
    }

    customer[flagField] = true;
    customer[dateField] = sub.date || null;
    customer.__dirty = true;
    perType[sub.type]++;
  }

  console.log(`${existingSnap.size} customers currently in Firestore (${duplicateEmails.size} duplicate email(s) noted above)`);
  console.log(`${created} NEW customer record(s) would be created`);
  console.log(`${flaggedExisting} EXISTING customer(s) would get a flag newly set`);
  console.log(`${alreadySet} subscription(s) targeted a customer that already had that flag set (later date still applied)`);
  console.log(`By type: newsletter=${perType.newsletter}, prayer=${perType.prayer}\n`);

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  // ---- Write: batched, 400 ops/batch to stay well under the 500 limit ----
  const toWrite = [...byEmail.values()].filter((c) => c.__new || c.__dirty);
  console.log(`Writing ${toWrite.length} customer record(s)...`);

  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  for (const c of toWrite) {
    const clean = { ...c };
    delete clean.__id;
    delete clean.__existed;
    delete clean.__new;
    delete clean.__dirty;

    if (c.__new) {
      const ref = tenantCollection(db, "customers").doc();
      batch.set(ref, clean);
    } else {
      const ref = tenantCollection(db, "customers").doc(c.__id);
      // Partial update (Admin SDK's update() merges, unlike the Angular
      // app's own setDoc()-based BaseService.update() - see firebase.dao.ts)
      // - only the 4 subscription fields, never touching name/email/notes/
      // pendingChanges already on file.
      const patch = {};
      for (const { flagField, dateField } of Object.values(FIELDS_BY_TYPE)) {
        if (flagField in clean) patch[flagField] = clean[flagField];
        if (dateField in clean) patch[dateField] = clean[dateField];
      }
      batch.update(ref, patch);
    }

    opsInBatch++;
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

  console.log(`Done - ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
