#!/usr/bin/env node
// Moves stored permission grants from `tools-manager.system-templates` to
// `tools-manager.email-designer`.
//
// System Templates was removed once every mail_template gained a home
// (2026-08-27). The full-screen email BUILDER outlived it and needed a grant
// of its own - it is reachable from five different managers, and a direct URL
// visit has no calling screen to borrow permission from.
//
// Without this, every admin who could edit templates silently loses that
// ability: the designer checks a key nobody has been granted, so the pencil
// stops appearing and the screens that launch it go quiet. Nothing errors.
//
// Same shape as scripts/migrate-screenkey-renames.js, which did this for the
// Customers->Contacts and Web->Content Manager renames.
//
//   node scripts/migrate-email-designer-grant.js --project=dev
//   ... add --execute to write.
//
// Idempotent: an admin who already has the new key is left alone, and the old
// key is dropped only once the new one is present.
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const OLD_KEY = "tools-manager.system-templates";
const NEW_KEY = "tools-manager.email-designer";
const OUT_DIR = path.join(__dirname, "output");

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
  const execute = args.execute === true;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = getFirestoreFor(projectId);
  const admins = await db.collection("admin_users").get();

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  ${OLD_KEY}`);
  console.log(`     -> ${NEW_KEY}`);
  console.log(`  admin_users: ${admins.size}`);
  console.log("");

  const plan = [];
  admins.forEach((doc) => {
    const data = doc.data();
    const perms = data.permissions;
    if (!Array.isArray(perms)) {
      return;
    }
    const old = perms.find((p) => p && p.screenKey === OLD_KEY);
    if (!old) {
      return;
    }
    const already = perms.some((p) => p && p.screenKey === NEW_KEY);
    plan.push({ id: doc.id, email: data.email ?? "(no email)", perms, old, already });
  });

  if (!plan.length) {
    console.log(`  No admin carries "${OLD_KEY}". Nothing to do.`);
    return;
  }

  for (const row of plan) {
    const g = row.old;
    const flags = ["view", "add", "edit", "delete"]
      .filter((k) => g[k]).join("/") || "none";
    console.log(`  ${row.email.padEnd(34)} ${flags}` +
      (row.already ? "   (already has the new key - old one will just be dropped)" : ""));
  }

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  const backup = path.join(OUT_DIR, `admin-permissions-before-designer-grant-${projectId}.json`);
  fs.writeFileSync(backup, JSON.stringify(
    plan.map((r) => ({ id: r.id, email: r.email, permissions: r.perms })), null, 2
  ), "utf8");
  console.log("");
  console.log(`  backed up ${plan.length} admin_users doc(s) to ${backup}`);

  for (const row of plan) {
    // Carry the SAME flags across rather than granting a fixed set - an
    // employee with view-only on templates must not come out of this able to
    // edit them.
    const next = row.perms.filter((p) => p && p.screenKey !== OLD_KEY);
    if (!row.already) {
      next.push({ ...row.old, screenKey: NEW_KEY });
    }
    await db.collection("admin_users").doc(row.id).update({ permissions: next });
  }
  console.log(`  migrated ${plan.length} admin(s).`);

  const after = await db.collection("admin_users").get();
  let stillOld = 0; let haveNew = 0;
  after.forEach((d) => {
    const p = d.data().permissions;
    if (!Array.isArray(p)) return;
    if (p.some((x) => x && x.screenKey === OLD_KEY)) stillOld++;
    if (p.some((x) => x && x.screenKey === NEW_KEY)) haveNew++;
  });
  console.log(`  admins still carrying the old key: ${stillOld}  (must be 0)`);
  console.log(`  admins carrying the new key      : ${haveNew}`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
