#!/usr/bin/env node
/**
 * Does every DEPLOYED Firestore trigger watch the path its data actually
 * lives at?
 *
 * WHY THIS EXISTS SEPARATELY FROM THE LIVENESS SUITE.
 * integration/trigger-liveness.test.js proves a trigger fires in the
 * EMULATOR, against the code in your working tree. It cannot tell you what
 * is deployed. A trigger fixed in the tree and never deployed looks
 * identical to a working one, and the failure is silent: a trigger whose
 * document pattern no longer matches simply never runs. No error, no log,
 * no deploy failure.
 *
 * It is also the ONLY check available for the four push-notification
 * triggers (notifyGroupChatMessage, notifyConversationMessage,
 * notifyJoinRequestActivity, notifyPrayerRequestShared). Their sole
 * Firestore side effect is deleting a token FCM rejects, so observing them
 * from a test needs a real FCM round trip - there is no messaging emulator -
 * and a liveness check that reports the network as often as the trigger
 * gets ignored. This asks a narrower question and answers it reliably.
 *
 * gcloud is NOT usable on this machine - it requires Python, which is
 * deliberately not installed - so this calls the Cloud Functions v2 REST
 * API with Application Default Credentials.
 *
 *   node scripts/verify-trigger-paths.js --project=prod
 *   node scripts/verify-trigger-paths.js --project=dev
 *
 * Exit code is non-zero if any trigger watches a path outside the tenant
 * that is not on the deliberate-exception list below, so this can gate a
 * release.
 */
"use strict";

const path = require("path");
const {GoogleAuth} = require(
  require.resolve("google-auth-library", {
    paths: [path.join(__dirname, "..", "functions")],
  })
);
const {resolveProjectId} = require("./lib/firestore-admin");
const {tenantPath, TENANT_ID} = require("./lib/tenancy");

const REGION = "us-central1";

/**
 * Triggers that correctly watch a path OUTSIDE the tenant. Each needs a
 * reason, because "it has always been like that" is how a real break gets
 * waved through.
 */
const DELIBERATE = {
  // `mail` is deliberately outside the seam: the firestore-send-email
  // extension owns that path and its watch location is configured in the
  // extension, not in our code. Moving it would silently stop all mail.
  onCampaignMailDelivered: "watches mail/{id}; `mail` is not seamed",
  "ext-firestore-send-email-processQueue":
    "the extension's own trigger; it does not expose a document filter",
};

const arg = process.argv.find((a) => a.startsWith("--project="));
const PROJECT = resolveProjectId(arg ? arg.split("=")[1] : "");

/**
 * Every deployed 2nd-gen function in the region.
 * @param {object} client An authenticated google-auth client.
 * @return {Promise<Array<object>>} The function resources.
 */
async function listFunctions(client) {
  let out = [];
  let token = "";
  do {
    const url =
      "https://cloudfunctions.googleapis.com/v2/projects/" +
      `${PROJECT}/locations/${REGION}/functions?pageSize=200` +
      (token ? `&pageToken=${token}` : "");
    const res = await client.request({url});
    out = out.concat(res.data.functions || []);
    token = res.data.nextPageToken || "";
  } while (token);
  return out;
}

/**
 * Entry point.
 * @return {Promise<void>} Resolves when the report is printed.
 */
async function main() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const fns = await listFunctions(client);

  const prefix = tenantPath("purchases").replace(/purchases$/, "");
  const rows = [];
  for (const fn of fns) {
    const t = fn.eventTrigger;
    if (!t || !/firestore/.test(t.eventType || "")) {
      continue;
    }
    const filter = (t.eventFilters || []).find(
      (f) => f.attribute === "document"
    );
    rows.push({
      name: fn.name.split("/").pop(),
      event: (t.eventType || "").split(".").pop(),
      doc: filter ? filter.value || filter.pathPattern || "" : "(none)",
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`project: ${PROJECT}`);
  console.log(`tenant:  ${prefix}  (id ${TENANT_ID})`);
  console.log(`${rows.length} Firestore triggers deployed\n`);

  const stale = [];
  for (const r of rows) {
    const inTenant = r.doc.startsWith(prefix);
    const excused = Object.prototype.hasOwnProperty.call(DELIBERATE, r.name);
    let flag = "  ";
    if (!inTenant && !excused) {
      flag = "!!";
      stale.push(r);
    } else if (!inTenant) {
      flag = "ok";
    }
    console.log(`${flag} ${r.name.padEnd(34)}${r.event.padEnd(9)}${r.doc}`);
    if (!inTenant && excused) {
      console.log(`     ^ deliberate: ${DELIBERATE[r.name]}`);
    }
  }

  if (stale.length === 0) {
    console.log(`\nAll ${rows.length} watch the tenant, or are excused.`);
    return;
  }
  console.log(
    `\n${stale.length} trigger(s) watch a path the migration moved away ` +
      "from. Each is SILENTLY not running:"
  );
  stale.forEach((s) => console.log(`  ${s.name} -> ${s.doc}`));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("FAILED:", err.message || err);
  process.exitCode = 1;
});
