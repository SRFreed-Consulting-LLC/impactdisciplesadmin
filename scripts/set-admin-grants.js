#!/usr/bin/env node
// Replaces an existing Employee's screen grants from the command line - the
// same `permissions` array the Admin Users screen's Permissions tab writes,
// for when nobody is at the app. Shows before/after; --execute applies.
//
//   node scripts/set-admin-grants.js --project=dev --email=x@y.z \
//     --grant=page-manager.coaching-with-impact [--grant=<screenKey>[:view]] --execute
//
// A --grant gives view+add+edit+delete; append :view for view-only. No
// --grant at all clears every grant. Only the `permissions` field is
// written (update, not set) so nothing else on the record can be clobbered.
// Refuses prod without --allow-prod.
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function args(name) {
  return process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
}

async function main() {
  const projectId = resolveProjectId(arg("project"));
  if (projectId === "impactdisciples-a82a8" && !process.argv.includes("--allow-prod")) {
    throw new Error("Refusing production without --allow-prod.");
  }
  const email = (arg("email") || "").trim().toLowerCase();
  if (!email) throw new Error("--email is required.");
  const execute = process.argv.includes("--execute");
  const permissions = args("grant").map((g) => {
    const [screenKey, mode] = g.split(":");
    const full = mode !== "view";
    return {screenKey, view: true, add: full, edit: full, delete: full};
  });

  const db = getFirestoreFor(projectId);
  const snap = await db.collection(tenantPath("admin_users")).where("email", "==", email).limit(1).get();
  if (snap.empty) throw new Error(`No admin_users row for ${email} on ${projectId}.`);
  const doc = snap.docs[0];
  const data = doc.data();
  if (data.role !== "Employee") {
    throw new Error(`${email} is ${data.role}, not Employee - grants only apply to Employees.`);
  }

  console.log(`\n${projectId}  admin_users/${doc.id}  ${data.firstName} ${data.lastName} (${data.role})${execute ? "  (EXECUTE)" : "  (dry run)"}`);
  console.log("before:");
  for (const p of data.permissions ?? []) console.log(`  ${p.screenKey}  view=${p.view} add=${p.add} edit=${p.edit} delete=${p.delete}`);
  if (!(data.permissions ?? []).length) console.log("  (none)");
  console.log("after:");
  for (const p of permissions) console.log(`  ${p.screenKey}  view=${p.view} add=${p.add} edit=${p.edit} delete=${p.delete}`);
  if (!permissions.length) console.log("  (none)");

  if (!execute) {
    console.log("\nDry run - re-run with --execute to apply.");
    return;
  }
  await doc.ref.update({permissions});
  console.log("\nApplied. The person sees it on their next sign-in or page reload.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
