#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Read-only. Sizes the damage from the createGroup `locationType` bug
// before we decide whether a backfill is worth writing.
//
// The bug: functions/src/library-groups.functions.ts narrowed the incoming
// locationType to "public-place"|"home" and gated the whole `location`
// write on it, but the shared DiscussionGroupLocation model and the create
// wizard both use 'public'|'private'. So locationType always resolved to
// undefined and the ENTIRE location object was dropped - every group made
// through the wizard stored no city, state, address or coordinates. Fixed
// in functions/src/library-group-location.ts; this script reports how many
// existing groups were already written without one.
//
// It matters because the web app's public Impact Group finder searches by
// city text and by distance - a group with no `location` can never appear
// in either, no matter what the leader typed into the wizard.
//
// Writes nothing, so there is no --execute flag. --project is still
// required (scripts/ convention: no default between dev and prod).
//
// Usage:
//   node scripts/audit-group-locations.js --project=dev
//   node scripts/audit-group-locations.js --project=prod
//   node scripts/audit-group-locations.js --project=prod --verbose
"use strict";

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

// Mirrors the admin Groups table's derivation - not a stored field.
function meetingType(g) {
  const inPerson = !!g.location || !!g.inPersonLocation;
  const online = !!g.onlineInfo;
  if (inPerson && online) return "hybrid";
  if (online) return "online";
  if (inPerson) return "in-person";
  return "none";
}

// The model's rule: absent groupVisibility means public, so always test
// === 'invite-only' rather than !== 'public'.
function isPubliclyListed(g) {
  return g.status === "open" && g.groupVisibility !== "invite-only";
}

function hasCoords(g) {
  return !!g.location &&
    typeof g.location.lat === "number" &&
    typeof g.location.lng === "number";
}

function pct(n, total) {
  if (!total) return "  - ";
  return `${String(Math.round((n / total) * 100)).padStart(3)}%`;
}

function row(label, n, total) {
  console.log(`  ${label.padEnd(46)} ${String(n).padStart(5)}  ${pct(n, total)}`);
}

function isoDay(ms) {
  return typeof ms === "number" ? new Date(ms).toISOString().slice(0, 10) : "?";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  const snap = await tenantCollection(db, "discussionGroups").get();
  const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const total = groups.length;

  console.log(`\n=== Impact Group location audit - ${projectId} ===\n`);
  if (!total) {
    console.log("  No groups in this project.\n");
    return;
  }

  console.log(`Total groups: ${total}`);
  row("open", groups.filter((g) => g.status === "open").length, total);
  row("closed", groups.filter((g) => g.status === "closed").length, total);
  row("invite-only", groups.filter((g) => g.groupVisibility === "invite-only").length, total);

  const structured = groups.filter((g) => !!g.location);
  const legacyOnly = groups.filter((g) => !g.location && !!g.inPersonLocation);
  const onlineOnly = groups.filter(
    (g) => !g.location && !g.inPersonLocation && !!g.onlineInfo);
  const noSignal = groups.filter((g) => meetingType(g) === "none");

  console.log("\nLocation data on the document:");
  row("structured `location` object", structured.length, total);
  row("  ...of those, with lat/lng", groups.filter(hasCoords).length, total);
  row("legacy `inPersonLocation` free text only", legacyOnly.length, total);
  row("online only (`onlineInfo`, no place)", onlineOnly.length, total);
  row("NO location signal at all  <-- the bug", noSignal.length, total);

  // What the public finder can actually do with each group.
  const listed = groups.filter(isPubliclyListed);
  const searchable = listed.filter((g) => !!g.location);
  const invisible = listed.filter(
    (g) => !g.location && meetingType(g) !== "online");

  console.log(`\nPublic finder impact (open + non-invite-only: ${listed.length}):`);
  row("searchable by city/state", searchable.length, listed.length);
  row("  ...of those, searchable by distance too",
    listed.filter(hasCoords).length, listed.length);
  row("in-person but NOT location-searchable", invisible.length, listed.length);
  row("online-only (never location-searchable)",
    listed.filter((g) => meetingType(g) === "online").length, listed.length);

  // Recovery prospects, which is the actual backfill decision.
  const geocodable = groups.filter((g) => !g.location && !!g.inPersonLocation);
  console.log("\nBackfill prospects:");
  row("recoverable by geocoding legacy free text", geocodable.length, total);
  // Nothing was ever persisted for these - not even the legacy free text -
  // so no script can reconstruct where they meet. Only the leader can.
  row("unrecoverable (nothing was ever stored)", noSignal.length, total);

  // Should be zero everywhere. If it is not, some group carries the stale
  // server enum and the display/label code will not recognise it.
  const staleEnum = structured.filter(
    (g) => g.location.locationType !== "public" &&
      g.location.locationType !== "private");
  if (staleEnum.length) {
    console.log(`\n  !! ${staleEnum.length} group(s) carry an unexpected ` +
      "locationType:");
    for (const g of staleEnum) {
      console.log(`     ${g.id}  ${JSON.stringify(g.location.locationType)}`);
    }
  }

  if (args.verbose) {
    const affected = groups
      .filter((g) => !g.location && meetingType(g) !== "online")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.log(`\nGroups with no structured location (${affected.length}):`);
    console.log(
      `  ${"created".padEnd(10)} ${"id".padEnd(22)} ${"status".padEnd(7)} title`);
    for (const g of affected) {
      const legacy = g.inPersonLocation ?
        `  [legacy: ${String(g.inPersonLocation).slice(0, 40)}]` : "";
      console.log(
        `  ${isoDay(g.createdAt).padEnd(10)} ${g.id.padEnd(22)} ` +
        `${String(g.status || "?").padEnd(7)} ${g.title || "(untitled)"}${legacy}`);
    }
  } else if (noSignal.length || legacyOnly.length) {
    console.log("\n  Re-run with --verbose to list the affected groups.");
  }

  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
