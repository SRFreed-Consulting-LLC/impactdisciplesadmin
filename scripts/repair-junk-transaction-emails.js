#!/usr/bin/env node
// One-time repair: transaction records whose `email` is not an email.
//
// Twelve purchases/registrations/affiliate-sales carry something else in the
// email box - a name, a street address, a single letter. None has a customer
// record, because isPlausibleEmail correctly refuses to create a contact
// from a non-address, so these orders sit unlinked and those people cannot
// be contacted.
//
// EVERY REPAIR BELOW IS A MATCH, NOT A GUESS. Each bad value is replaced
// with an address the SAME PERSON already has on another record in this
// database (matched on first+last name), with one stated exception. The
// difference matters: a wrong address here mails somebody's receipt and
// order details to a stranger.
//
// Deliberately NOT repaired, and why:
//   "gmail.com"                (Philip kee) - the only valid address under
//       that name belongs to Deborah Kee. A different person, probably a
//       spouse. Assigning his registration to her address is a guess.
//   "monserrateperezmercedes"  (x3) - no valid address anywhere in the
//       database for this person. Phone 8094053217 is the only way to reach
//       them.
//   "75 fawn ridge"            - no name on the record. A purchase at that
//       street exists (Cookie Smith) but it is a DIFFERENT transaction: a
//       year earlier and a different total. The one same-day CRFREE order
//       for the same amount belongs to someone else at another address.
//
// Dry-run by default.
//
//   node scripts/repair-junk-transaction-emails.js --project=prod [--execute]

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

// from -> {to, basis}. Applied across all three collections wherever the
// stored value matches exactly (case-insensitively, trimmed).
const REPAIRS = [
  {
    from: "x",
    to: "maclakeonline@gmail.com",
    basis: "Mac Lake's own other record carries this address",
  },
  {
    from: "alan.williamsf4au",
    to: "alan.williamsf4au@gmail.com",
    basis: "Alan Williams' own other record - the stored value IS the local part, the @domain was lost",
  },
  {
    from: "cnipper20@gmail com",
    to: "cnipper20@gmail.com",
    basis: "Cody Nipper's own other record confirms it - a space was typed instead of the dot",
  },
  {
    from: "terri",
    to: "tm@terrimatthews.co",
    basis: "Terri Matthews-Woodall's own other record carries this address",
  },
  {
    from: "sharonelliott202@gmail",
    to: "sharonelliott202@gmail.com",
    // The one repair with no corroborating record. Included because "@gmail"
    // has exactly one completion - it is not a deliverable domain on its own
    // - so this is a typo repair, not a choice between candidates.
    basis: "TYPO INFERENCE (no second record): '@gmail' completes only to '@gmail.com'",
  },
];

const COLLECTIONS = ["purchases", "event-registrations", "affilliate_sales"];

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value === undefined ? true : value;
};

const norm = (v) => String(v ?? "").trim().toLowerCase();

(async () => {
  const project = arg("project");
  if (!project) {
    console.error("Usage: node scripts/repair-junk-transaction-emails.js --project=dev|prod [--execute]");
    process.exit(1);
  }
  const execute = !!arg("execute");
  const db = getFirestoreFor(resolveProjectId(project));
  const byFrom = new Map(REPAIRS.map((r) => [norm(r.from), r]));

  const plan = [];
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).select("email", "firstName", "lastName").get();
    snap.forEach((doc) => {
      const repair = byFrom.get(norm(doc.get("email")));
      if (!repair) return;
      plan.push({
        ref: doc.ref,
        collection: name,
        id: doc.id,
        who: `${doc.get("firstName") || "?"} ${doc.get("lastName") || "?"}`.trim(),
        from: doc.get("email"),
        to: repair.to,
        basis: repair.basis,
      });
    });
  }

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${resolveProjectId(project)}"\n`);
  plan.forEach((p) => {
    console.log(`  ${p.collection}/${p.id}  (${p.who})`);
    console.log(`      ${JSON.stringify(p.from)}  ->  ${JSON.stringify(p.to)}`);
    console.log(`      basis: ${p.basis}`);
  });
  console.log(`\n${plan.length} record(s) to repair`);

  if (!plan.length) {
    console.log("Nothing to do.");
    return;
  }
  if (!execute) {
    console.log("[dry-run] nothing written. Re-run with --execute to apply.");
    return;
  }

  const batch = db.batch();
  plan.forEach((p) => batch.update(p.ref, { email: p.to }));
  await batch.commit();
  console.log(`repaired ${plan.length} record(s)`);

  // A repaired address only reconnects the record to a CONTACT if one
  // exists - the customer-upsert triggers fire on create, so they will not
  // retroactively build one. Report which addresses still have no contact.
  const emails = [...new Set(plan.map((p) => p.to))];
  for (const email of emails) {
    const found = await db.collection("customers").where("email", "==", email).limit(1).get();
    console.log(`   ${email}: ${found.empty ? "NO contact record - order stays unlinked" : "contact exists, now linked"}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
