#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Seeds the "Amazon Shipping Confirmation" mail_templates doc - the
// template PurchasesService.sendAmazonConfirmation() renders when an
// order takes the Amazon fulfillment branch (2026-08-19 workflow change).
// LOAD-BEARING NAME: looked up by the literal name below, same convention
// as "Sales Receipt" (see CLAUDE.md's email taxonomy note) - renaming the
// doc breaks the send. Content is editable in the designer afterward.
// Idempotent by name.
//
// Usage: node scripts/seed-amazon-confirmation-template.js --project=dev [--execute]

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const NAME = "Amazon Shipping Confirmation";

const HTML =
  "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:14px;" +
  "line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:24px;\">" +
  "<h2 style=\"color:#1f2430;\">Your order is on its way!</h2>" +
  "<p>Hi *|FNAME|*,</p>" +
  "<p>Good news - your Impact Disciples order has shipped and is being " +
  "delivered via <b>Amazon</b>.</p>" +
  // *|TRACKING|inline fallback|* - the send passes "Tracking: <value>" when
  // the admin entered one, otherwise the fallback sentence renders.
  "<p>*|TRACKING|You'll receive delivery updates directly from Amazon.|*</p>" +
  "<p>Thank you for supporting the mission of Impact Disciples!</p>" +
  "<p style=\"color:#6a7280;font-size:12px;\">If you have any questions " +
  "about your order, just reply to this email.</p>" +
  "</div>";

(async () => {
  const db = getFirestoreFor(resolveProjectId(args.project));
  const existing = await tenantCollection(db, "mail_templates")
    .where("name", "==", NAME).limit(1).get();
  if (!existing.empty) {
    console.log(`SKIP (exists): ${NAME} (${existing.docs[0].id})`);
    return;
  }
  if (!args.execute) {
    console.log(`WOULD SEED: ${NAME}`);
    return;
  }
  const ref = await tenantCollection(db, "mail_templates").add({
    name: NAME,
    subject: "Your Impact Disciples order is on its way!",
    html: HTML,
    attachments: [],
  });
  console.log(`SEEDED: ${NAME} (${ref.id})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
