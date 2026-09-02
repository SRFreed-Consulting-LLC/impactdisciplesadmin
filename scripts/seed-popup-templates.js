#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Campaign Manager v2, Phase 5: seeds the popup_templates collection (the
// popup recipe library) - popup-shaped descendants of the v1 campaign
// gallery's six recipe consts (campaign-template.model.ts, removed in
// Phase 1; copy recovered from git). Idempotent by name.
//
// Usage: node scripts/seed-popup-templates.js --project=dev [--execute]

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

/**
 * A simple, brand-neutral popup body. Content html only - the renderer
 * supplies the box (width/height/bg), close button, and don't-show-again
 * checkbox.
 * @param {string} headline Big line.
 * @param {string} supporting Supporting sentence.
 * @param {string} cta Button label.
 * @return {string} Popup html.
 */
function popupHtml(headline, supporting, cta) {
  return "<div style=\"font-family:Helvetica,Arial,sans-serif;" +
    "text-align:center;padding:26px 22px;\">" +
    `<h2 style="margin:0 0 10px;font-size:24px;color:#1f2430;">${headline}</h2>` +
    `<p style="margin:0 0 18px;font-size:15px;color:#454d58;line-height:1.5;">${supporting}</p>` +
    "<span style=\"display:inline-block;background:#1f3a5f;color:#ffffff;" +
    "padding:12px 30px;border-radius:6px;font-weight:700;\">" +
    `${cta}</span></div>`;
}

const TEMPLATES = [
  {
    name: "Product Spotlight",
    title: "Product Spotlight",
    html: popupHtml("Our newest resource is here",
      "Take a look at the newest addition to the store.", "Shop Now"),
    width: 480, height: 300, bgColor: "#ffffff",
  },
  {
    name: "Event Countdown",
    title: "Event Countdown",
    html: popupHtml("Time is running out to register",
      "Spots are filling up - register today.", "Register"),
    width: 480, height: 300, bgColor: "#ffffff",
  },
  {
    name: "Discount for Email",
    title: "Discount for Email",
    html: popupHtml("Get 10% off your first order",
      "Join our email list and we'll send your code right away.", "Join the List"),
    width: 480, height: 300, bgColor: "#f5f2ec",
  },
  {
    name: "Free Resource",
    title: "Free Resource",
    html: popupHtml("Get our free study guide",
      "Join our email list and we'll send it right over.", "Get the Guide"),
    width: 480, height: 300, bgColor: "#f5f2ec",
  },
];

(async () => {
  const db = getFirestoreFor(resolveProjectId(args.project));
  const existing = new Set(
    (await tenantCollection(db, "popup_templates").get()).docs.map((d) => d.data().name));
  for (const template of TEMPLATES) {
    if (existing.has(template.name)) {
      console.log(`SKIP (exists): ${template.name}`);
      continue;
    }
    if (args.execute) {
      await tenantCollection(db, "popup_templates").add(template);
      console.log(`SEEDED: ${template.name}`);
    } else {
      console.log(`WOULD SEED: ${template.name}`);
    }
  }
  console.log(args.execute ? "Done." : "Dry run - rerun with --execute.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
