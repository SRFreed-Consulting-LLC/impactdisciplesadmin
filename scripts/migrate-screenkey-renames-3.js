const {tenantCollection} = require("./lib/tenancy");
// One-time (idempotent) migration of stored ScreenPermission.screenKey values
// in `admin_users` after the 2026-08-30 DATA restructure - the third of these,
// same shape as migrate-screenkey-renames.js (Customers->Contacts) and -2.js
// (Contacts & Events).
//
// Five screens were gathered into a new DATA manager from four others, by
// what they ARE rather than which module happened to own them:
//
//   page-manager.testimonials              -> data.testimonials
//   page-manager.team-page                 -> data.team-page
//   contacts-manager.custom-form-submissions -> data.custom-form-submissions
//   store-manager.products                 -> data.products
//   tools-manager.form-builder             -> data.form-builder
//
// A screenKey is `group.id` + `leaf.slug`, so moving a screen between groups
// changes its identity - unlike the drawer SECTION a group sits under, which
// is a rank above the group and changes nothing. A grant left on the old key
// grants nothing at all: PermissionService looks the new key up and finds
// no entry. Pinned shortcuts (`pinnedScreens`) are keyed the same way and are
// rewritten too, or a pin quietly stops appearing.
//
// Run against an environment WHEN the restructured app deploys there:
//   node scripts/migrate-screenkey-renames-3.js --project=dev|prod [--dry-run]
//
// PRODUCTION HAS NOT BEEN RUN - see MIGRATION.md. There is no hurry: the old
// keys stay correct in prod until the code that renames them ships there.

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

const MOVED = {
  'page-manager.testimonials': 'data.testimonials',
  'page-manager.team-page': 'data.team-page',
  'contacts-manager.custom-form-submissions': 'data.custom-form-submissions',
  'store-manager.products': 'data.products',
  'tools-manager.form-builder': 'data.form-builder',
};

// Returns the new key, or the key unchanged. Nothing is dropped by this
// migration - every screen that moved still exists.
function renameKey(key) {
  return MOVED[key] || key;
}

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/migrate-screenkey-renames-3.js --project=dev|prod [--dry-run]');
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
      const next = data.permissions.map((p) => {
        if (!p || !p.screenKey) return p;
        return { ...p, screenKey: renameKey(p.screenKey) };
      });
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
