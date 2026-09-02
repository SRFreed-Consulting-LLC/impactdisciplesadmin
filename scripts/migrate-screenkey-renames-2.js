const {tenantCollection} = require("./lib/tenancy");
// One-time (idempotent) migration of stored ScreenPermission.screenKey
// values in `admin_users` after the 2026-08-19 Contacts & Events
// restructure (same shape as migrate-screenkey-renames.js, the
// Customers->Contacts precedent):
//   events-manager.organizations -> contacts-manager.organizations (moved)
//   events-manager.locations     -> dropped (screen retired outright)
//   events-manager.courses       -> dropped (Phase 4 - Courses retired)
// Also rewrites/drops matching `pinnedScreens` entries.
//
// Run against an environment WHEN the restructured app deploys there:
//   node scripts/migrate-screenkey-renames-2.js --project=dev|prod [--dry-run]

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

// Returns the new key, or null when the screen no longer exists.
function renameKey(key) {
  if (key === 'events-manager.organizations') return 'contacts-manager.organizations';
  if (key === 'events-manager.locations') return null;
  if (key === 'events-manager.courses') return null;
  return key;
}

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/migrate-screenkey-renames-2.js --project=dev|prod [--dry-run]');
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
      const next = data.permissions
        .map((p) => {
          if (!p || !p.screenKey) return p;
          const renamed = renameKey(p.screenKey);
          return renamed === null ? null : { ...p, screenKey: renamed };
        })
        .filter(Boolean);
      if (JSON.stringify(next) !== JSON.stringify(data.permissions)) update.permissions = next;
    }
    if (Array.isArray(data.pinnedScreens)) {
      const next = data.pinnedScreens
        .map((k) => (typeof k === 'string' ? renameKey(k) : k))
        .filter(Boolean);
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
