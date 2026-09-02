#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Seeds (and removes) disposable Impact Groups so the web app's public
// finder has something deterministic to assert against.
//
// Same reasoning as seed-e2e-popup.js: the web repo's Playwright suite is
// read-only and has no Admin SDK, so the writing half lives here. Dev and
// prod both currently have ZERO discussion groups, which means the finder
// specs would otherwise only ever exercise the empty state.
//
// The set is chosen to cover the EXCLUSION rules, not just the happy path.
// search_impact_groups is the only anonymous read path onto discussionGroups
// and its projection is a security boundary - two of these four groups exist
// purely to prove they never reach the public site, and the online one
// carries a fake meeting link so a spec can assert `onlineInfo` is never
// published.
//
// Written with the Admin SDK, which bypasses firestore.rules - the same
// reason the real createGroup is a Cloud Function. Every id is prefixed
// `e2e-group-` and every doc is marked `e2eFixture: true`; --remove refuses
// to delete anything lacking that marker.
//
// Usage:
//   node scripts/seed-e2e-groups.js --project=dev            (dry run)
//   node scripts/seed-e2e-groups.js --project=dev --execute
//   node scripts/seed-e2e-groups.js --project=dev --remove --execute
"use strict";

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const DAY = 24 * 60 * 60 * 1000;

/** The four fixtures. Two must appear publicly; two must never. */
function fixtures() {
  const now = Date.now();
  const base = {
    bookId: "e2e-fixture-book",
    creatorEmail: "e2e-leader@example.com",
    creatorDisplayName: "Casey Fixture",
    startDate: now + 30 * DAY,
    startTimeZone: "America/New_York",
    createdAt: now,
    updatedAt: now,
    e2eFixture: true,
  };

  return {
    // SHOWS. In-person, address visible, real coordinates (Duluth GA) so a
    // distance search has something to match.
    "e2e-group-inperson": {
      ...base,
      title: "E2E Fixture Morning Group",
      description: "Seeded by scripts/seed-e2e-groups.js. Safe to delete.",
      status: "open",
      groupVisibility: "public",
      location: {
        country: "US",
        state: "GA",
        city: "Duluth",
        locationType: "public",
        address1: "1234 Fixture Street",
        addressVisible: true,
        lat: 34.0029,
        lng: -84.1446,
      },
      // maxMembers excludes the creator, memberCount includes them:
      // 12 - (10 - 1) = 3 spots left.
      maxMembers: 12,
      memberCount: 10,
      pendingCount: 2,
    },

    // SHOWS. Online-only. onlineInfo holds what a real one holds - a link
    // and a passcode - so a spec can prove the projection withholds it.
    "e2e-group-online": {
      ...base,
      title: "E2E Fixture Evening Online",
      status: "open",
      groupVisibility: "public",
      onlineInfo:
        "https://zoom.example.com/j/E2E-SECRET-LINK passcode: e2e-secret-pass",
    },

    // HIDDEN. Invite-only is only a client-side filter in the reader; for
    // anonymous traffic the function is the first place it is real.
    "e2e-group-invite-only": {
      ...base,
      title: "E2E Fixture Invite Only",
      status: "open",
      groupVisibility: "invite-only",
      location: {
        country: "US",
        state: "GA",
        city: "Duluth",
        locationType: "private",
        addressVisible: false,
        lat: 34.0029,
        lng: -84.1446,
      },
    },

    // HIDDEN. A closed group keeps its document but leaves the browse list.
    "e2e-group-closed": {
      ...base,
      title: "E2E Fixture Closed Group",
      status: "closed",
      groupVisibility: "public",
      closedAt: now,
    },
  };
}

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
  if (projectId !== "impactdisciplesdev" && !args.force) {
    throw new Error(
      `Refusing to touch ${projectId}. These fixtures are for dev only; ` +
      "pass --force if you genuinely mean to."
    );
  }
  const db = getFirestoreFor(projectId);
  const execute = args.execute === true;
  const docs = fixtures();

  if (args.remove) {
    let removed = 0;
    for (const id of Object.keys(docs)) {
      const ref = tenantCollection(db, "discussionGroups").doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      if (snap.data().e2eFixture !== true) {
        throw new Error(
          `discussionGroups/${id} is NOT marked e2eFixture - refusing to ` +
          "delete something that may be real."
        );
      }
      console.log(`${execute ? "Deleting" : "[dry run] would delete"} ${id}`);
      if (execute) await ref.delete();
      removed++;
    }
    console.log(`\n${removed} fixture group(s) ${execute ? "removed" : "found"}.`);
    return;
  }

  console.log(`${execute ? "Writing" : "[dry run] would write"} ` +
    `${Object.keys(docs).length} fixture groups in ${projectId}:\n`);
  for (const [id, doc] of Object.entries(docs)) {
    const visible = doc.status === "open" && doc.groupVisibility !== "invite-only";
    console.log(`   ${id}`);
    console.log(`     ${doc.title}`);
    console.log(`     status=${doc.status} visibility=${doc.groupVisibility} ` +
      `-> ${visible ? "SHOWS publicly" : "must stay HIDDEN"}`);
    if (execute) {
      await tenantCollection(db, "discussionGroups").doc(id).set(doc);
    }
  }
  if (execute) {
    console.log("\nDone. search_impact_groups caches for 60s, so allow a " +
      "minute before the finder reflects these.");
    console.log("Remove them with --remove --execute when finished.");
  } else {
    console.log("\nRe-run with --execute to write them.");
  }
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
