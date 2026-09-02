const {tenantCollection} = require("./lib/tenancy");
// One-time (idempotent) migration of stored ScreenPermission.screenKey
// values in `admin_users` after the 2026-08-19 renames:
//   customers-manager.*         -> contacts-manager.*
//   customers-manager.customers -> contacts-manager.contacts (slug changed too)
//   web-manager.*               -> content-manager.*
//   tools-manager.web-config    -> content-manager.web-config (screen moved)
//   reports-manager.customers   -> reports-manager.contacts
// Also rewrites `pinnedScreens` entries (same screenKey vocabulary - see
// admin-user.model.ts).
//
// Run against an environment WHEN the renamed app deploys there, not before
// (old keys are what the still-deployed old app checks against):
//   node scripts/migrate-screenkey-renames.js --project=dev
//   node scripts/migrate-screenkey-renames.js --project=prod
// Add --dry-run to preview without writing.

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

function renameKey(key) {
  if (key === 'customers-manager.customers') return 'contacts-manager.contacts';
  if (key === 'tools-manager.web-config') return 'content-manager.web-config';
  if (key === 'reports-manager.customers') return 'reports-manager.contacts';
  if (key.startsWith('customers-manager.')) return key.replace('customers-manager.', 'contacts-manager.');
  if (key.startsWith('web-manager.')) return key.replace('web-manager.', 'content-manager.');
  return key;
}

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/migrate-screenkey-renames.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));
  const snap = await tenantCollection(db, "admin_users").get();
  let changed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    if (Array.isArray(data.permissions)) {
      const next = data.permissions.map((p) => (p && p.screenKey ? { ...p, screenKey: renameKey(p.screenKey) } : p));
      if (JSON.stringify(next) !== JSON.stringify(data.permissions)) update.permissions = next;
    }
    if (Array.isArray(data.pinnedScreens)) {
      const next = data.pinnedScreens.map((k) => (typeof k === 'string' ? renameKey(k) : k));
      if (JSON.stringify(next) !== JSON.stringify(data.pinnedScreens)) update.pinnedScreens = next;
    }
    if (Object.keys(update).length) {
      changed++;
      console.log(`${dryRun ? '[dry-run] would update' : 'updating'} ${doc.id} (${data.email || 'no email'}):`, JSON.stringify(update));
      if (!dryRun) await doc.ref.update(update);
    }
  }
  console.log(`done - ${changed} of ${snap.size} admin_users doc(s) ${dryRun ? 'would change' : 'updated'}`);
})().catch((e) => { console.error(e); process.exit(1); });
