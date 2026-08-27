#!/usr/bin/env node
// One-time (idempotent) backfill: lowercase/trim the `email` field on the
// three transaction collections that join to `customers` by it.
//
// WHY. A contact's activity feed streams purchases and registrations with an
// exact `where("email", "==", customer.email)`
// (contact-details.component.ts -> FirebaseDAO.streamByValue). `customers`
// is fully normalized as of 2026-08-27, but transaction records stored
// whatever the shopper typed - so an order placed as "Dgpark@hotmail.com"
// never appeared under the contact "dgpark@hotmail.com". Measured before
// this ran: 355 customers with 437 purchases/registrations silently missing
// from their feed.
//
// Run AFTER the write-time normalization is deployed (buildCheckoutForm in
// paypal.functions.ts, and the admin attendee dialog), or the problem
// re-accrues on the next order. The public RSVP path and every reader path
// already normalized.
//
// SAFE TO LOWERCASE? Yes. This field is an identifier the system joins on,
// not preserved prose: receipts were already sent (`mail.to` is a separate,
// untouched field), and no reader anywhere depends on the original casing.
//
//   node scripts/normalize-transaction-emails.js --project=prod [--execute]

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const COLLECTIONS = ["purchases", "event-registrations", "affilliate_sales"];

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value === undefined ? true : value;
};

const normalize = (value) => String(value ?? "").trim().toLowerCase();

(async () => {
  const project = arg("project");
  if (!project) {
    console.error("Usage: node scripts/normalize-transaction-emails.js --project=dev|prod [--execute]");
    process.exit(1);
  }
  const execute = !!arg("execute");
  const db = getFirestoreFor(resolveProjectId(project));

  let grandTotal = 0;
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).select("email").get();
    const fixes = [];
    snap.forEach((doc) => {
      const raw = doc.get("email");
      if (typeof raw !== "string" || !raw) return;
      const clean = normalize(raw);
      // Deliberately NOT skipping addresses that fail an email-shape check:
      // junk like "x" or "75 Fawn Ridge" is already unmatchable, and
      // lowercasing it changes nothing. Repairing junk is a separate job.
      if (raw === clean) return;
      fixes.push({ ref: doc.ref, id: doc.id, from: raw, to: clean });
    });

    console.log(`${name}: ${snap.size} scanned, ${fixes.length} to normalize`);
    fixes.slice(0, 3).forEach((f) =>
      console.log(`   ${f.id}: ${JSON.stringify(f.from)} -> ${JSON.stringify(f.to)}`));
    if (fixes.length > 3) console.log(`   ... and ${fixes.length - 3} more`);
    grandTotal += fixes.length;

    if (!execute || !fixes.length) continue;
    for (let i = 0; i < fixes.length; i += 400) {
      const chunk = fixes.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach((f) => batch.update(f.ref, { email: f.to }));
      await batch.commit();
    }
    console.log(`   committed ${fixes.length}`);
  }

  console.log(execute ?
    `\nnormalized ${grandTotal} transaction email(s)` :
    `\n[dry-run] ${grandTotal} would change. Re-run with --execute to apply.`);
})().catch((e) => { console.error(e); process.exit(1); });
