#!/usr/bin/env node
// One-time fix for purchases with a blank email/firstName/lastName that
// nonetheless have a real attendee on one of their cartItems (event ticket
// purchases capture the attendee's name/email on the cart item itself, but
// the storefront checkout form apparently lets the order's own top-level
// contact fields stay blank when the order is coupon-covered/free - see the
// session that produced this script for how it was found: 9 of 17 fully-
// anonymous purchases in dev turned out to be Disciple-Making Summit
// registrations with real attendee data sitting right there).
//
// For each qualifying purchase, uses the FIRST attendee on the first event
// cartItem as the purchase's own firstName/lastName/email. For orders with
// more than one attendee this is a best guess (whoever's listed first is
// usually who filled out the form) - those are called out explicitly in
// the report rather than silently treated the same as the unambiguous
// ones, so they can be double-checked.
//
// Does NOT touch the customers collection - onPurchaseCustomerUpsert only
// fires on purchase CREATION, so backfilling these purchases retroactively
// won't itself create/update a customer record. Run
// backfill-customers-from-purchases.js afterward if you want that too (it
// reads purchases fresh, so it'll pick up these fixed fields automatically).
//
// Dry-run by default. Pass --execute to actually write.
// --project=dev|prod required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/backfill-purchase-contact-from-attendees.js --project=dev
//   node scripts/backfill-purchase-contact-from-attendees.js --project=dev --execute

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const purchasesSnap = await db.collection("purchases").get();
  const candidates = [];

  purchasesSnap.docs.forEach((doc) => {
    const data = doc.data();
    const hasEmail = typeof data.email === "string" && data.email.trim();
    if (hasEmail) return;

    const eventItem = (data.cartItems || []).find((c) => c.isEvent && Array.isArray(c.attendees) && c.attendees.length > 0);
    if (!eventItem) return;

    const primary = eventItem.attendees[0];
    if (!primary || !primary.email) return;

    candidates.push({
      id: doc.id,
      itemName: eventItem.itemName,
      attendeeCount: eventItem.attendees.length,
      ambiguous: eventItem.attendees.length > 1,
      firstName: primary.firstName || "",
      lastName: primary.lastName || "",
      email: primary.email.trim().toLowerCase(),
      allAttendees: eventItem.attendees.map((a) => `${a.firstName || ""} ${a.lastName || ""} <${a.email || "?"}>`.trim())
    });
  });

  console.log(`${candidates.length} purchase(s) can be fixed from their own attendee data\n`);
  for (const c of candidates) {
    const flag = c.ambiguous ? `  ** ${c.attendeeCount} attendees, used first - verify: [${c.allAttendees.join(", ")}]` : "";
    console.log(`  ${c.id}  ->  "${c.firstName} ${c.lastName}" <${c.email}>  (${c.itemName})${flag}`);
  }

  if (!execute) {
    console.log("\nDry run only - re-run with --execute to write.");
    return;
  }

  console.log(`\nWriting ${candidates.length} purchase(s)...`);
  const batch = db.batch();
  for (const c of candidates) {
    batch.update(db.collection("purchases").doc(c.id), {
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email
    });
  }
  await batch.commit();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
