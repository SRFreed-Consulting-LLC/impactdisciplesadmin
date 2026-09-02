#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Seeds (and removes) a disposable campaign popup so the web app's
// Playwright suite has something deterministic to assert against.
//
// Why this exists as a SCRIPT rather than as Playwright setup: the web
// repo's e2e suite is deliberately read-only and has no Admin SDK - it
// asserts against real impactdisciplesdev data (see its playwright.config
// .ts). Keeping the fixture here preserves that: the spec still only
// reads, and the one thing that writes lives with the other data scripts,
// authenticated the same way (ADC).
//
// The popup is what carries a campaign onto the public site - it is the
// delivery mechanism for an early-bird push - and nothing has ever
// exercised it end to end. Dev currently has zero popups, so without a
// fixture the spec would pass vacuously.
//
// The seeded doc is marked with `e2eFixture: true` and uses a fixed id, so
// --remove can never delete a real popup.
//
// Usage:
//   node scripts/seed-e2e-popup.js --project=dev            (dry run)
//   node scripts/seed-e2e-popup.js --project=dev --execute
//   node scripts/seed-e2e-popup.js --project=dev --remove --execute
"use strict";

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

// Fixed, obviously-disposable id. Also the campaignId, so the popup's
// ?cid= attribution is predictable for the spec.
const FIXTURE_ID = "e2e-fixture-popup";

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

function fixtureDoc(firestore) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return {
    campaignId: FIXTURE_ID,
    isActive: true,
    // A window that is open now and closes well after any test run, so a
    // spec never fails because a fixture quietly expired overnight.
    fromDate: firestore.Timestamp.fromMillis(now - DAY),
    toDate: firestore.Timestamp.fromMillis(now + 365 * DAY),
    title: "E2E Fixture Popup",
    // The marker the spec looks for. Kept in the html because that is what
    // the renderer actually injects.
    html: "<h3>E2E Fixture Popup</h3><p data-e2e=\"popup-body\">" +
      "Seeded by scripts/seed-e2e-popup.js. Safe to delete.</p>",
    width: 480,
    height: 420,
    cta: {
      type: "form",
      primaryLabel: "Sign me up",
      dismissLabel: "No thanks",
      formFields: ["email", "firstName"],
      formDestination: "newsletter",
    },
    e2eFixture: true,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  if (projectId !== "impactdisciplesdev" && !args.force) {
    throw new Error(
      `Refusing to touch ${projectId}. This fixture is for dev only; ` +
      "pass --force if you genuinely mean to."
    );
  }
  const db = getFirestoreFor(projectId);
  const { firestore } = require("./lib/firestore-admin");
  const ref = tenantCollection(db, "campaign_popups").doc(FIXTURE_ID);
  const execute = args.execute === true;

  if (args.remove) {
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`No fixture at campaign_popups/${FIXTURE_ID} - nothing to do.`);
      return;
    }
    if (snap.data().e2eFixture !== true) {
      throw new Error(
        `campaign_popups/${FIXTURE_ID} is NOT marked e2eFixture - refusing ` +
        "to delete something that may be real."
      );
    }
    console.log(`${execute ? "Deleting" : "[dry run] would delete"} ` +
      `campaign_popups/${FIXTURE_ID}`);
    if (execute) await ref.delete();
    return;
  }

  const doc = fixtureDoc(firestore);
  console.log(`${execute ? "Writing" : "[dry run] would write"} ` +
    `campaign_popups/${FIXTURE_ID} in ${projectId}:`);
  console.log(`   title      : ${doc.title}`);
  console.log(`   cta        : ${doc.cta.type} -> ${doc.cta.formDestination}`);
  console.log(`   window     : open now, closes in 365 days`);
  if (execute) {
    await ref.set(doc);
    console.log("\nDone. Remove it with --remove --execute when finished.");
  } else {
    console.log("\nRe-run with --execute to write it.");
  }
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
