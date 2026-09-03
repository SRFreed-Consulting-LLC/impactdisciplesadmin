#!/usr/bin/env node
// Creates a staff account the way the admin app's own Add flow does - a
// Firebase Auth user plus its admin_users profile, kept in sync - but from
// the command line, with an optional password and an optional permission
// grant list, for a DEV account somebody needs to sign in as right now.
//
// The app's createAdminUser Cloud Function deliberately sets NO password and
// emails a reset link; that stays the way production accounts are made
// (owner, 2026-09-03). This script exists for dev, where a tester needs a
// known password and nobody is reading the reset email.
//
//   node scripts/create-admin-user.js --project=dev --email=x@y.z \
//     --first=Kevin --last=Burrell --role=Employee --password=secret \
//     --grant=data.disciple-making-minute --grant=page-manager.coaching-with-impact
//
// --grant may repeat; each grants view+add+edit+delete on that screenKey
// (append :view for view-only). Refuses to run against prod unless
// --allow-prod is passed, and never overwrites an existing admin_users row.
const {resolveProjectId, getFirestoreFor, getAuth, getApp} =
  require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function args(name) {
  return process.argv
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3));
}

async function main() {
  const projectId = resolveProjectId(arg("project"));
  if (projectId === "impactdisciples-a82a8" && !process.argv.includes("--allow-prod")) {
    throw new Error("Production accounts are created in the admin app (password-reset email). Pass --allow-prod to override.");
  }
  const email = (arg("email") || "").trim().toLowerCase();
  const firstName = arg("first");
  const lastName = arg("last");
  const role = arg("role");
  const password = arg("password");
  if (!email || !firstName || !lastName || !role) {
    throw new Error("--email, --first, --last and --role are required.");
  }
  if (!["Admin", "Employee", "Editor"].includes(role)) {
    throw new Error("--role must be Admin, Employee or Editor.");
  }
  const permissions = args("grant").map((g) => {
    const [screenKey, mode] = g.split(":");
    const full = mode !== "view";
    return {screenKey, view: true, add: full, edit: full, delete: full};
  });

  const db = getFirestoreFor(projectId);
  const auth = getAuth(getApp(`${projectId}::(default)`));
  const adminUsers = db.collection(tenantPath("admin_users"));

  const existing = await adminUsers.where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    throw new Error(`admin_users already has ${email} (${existing.docs[0].id}) - edit it in the app.`);
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Auth account exists (${user.uid})${password ? " - setting the password" : ""}`);
    if (password) await auth.updateUser(user.uid, {password});
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await auth.createUser({email, ...(password ? {password} : {})});
    console.log(`Auth account created (${user.uid})`);
  }

  const ref = await adminUsers.add({
    email,
    firstName,
    lastName,
    role,
    phone: null,
    shippingAddress: null,
    billingAddress: null,
    firebaseUID: user.uid,
    // Written explicitly, even when empty: an account created AFTER the
    // permission system shipped must never be auto-seeded with the legacy
    // grant set (see admin-users.component.ts onSave).
    permissions: role === "Employee" ? permissions : [],
  });
  console.log(`admin_users/${ref.id} written: ${role}, ${permissions.length} grant(s)`);
  for (const p of permissions) console.log(`  ${p.screenKey}  view=${p.view} add=${p.add} edit=${p.edit} delete=${p.delete}`);
  console.log("The onAdminUserRoleSync trigger stamps the role claim; allow a few seconds before signing in.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
