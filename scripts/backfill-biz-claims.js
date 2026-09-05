// Stamps the `biz` custom claim onto every existing admin_users account.
//
//   node scripts/backfill-biz-claims.js --project=prod            (dry run)
//   node scripts/backfill-biz-claims.js --project=prod --execute
//
// Dry-run by default.
//
// WHY IT EXISTS, and why it must run BEFORE the rules ship. onAdminUserRoleSync
// stamps `biz` on every admin_users write, but a trigger only fires on a
// write - so accounts that already exist carry no claim until somebody edits
// them. Deploy the rule first and a staff member who should have access is
// refused until their document happens to change.
//
// ORDER: functions deploy -> this script -> rules deploy.
//
// The rollout window is small by design: hasBusinessData() in the rules is
// `isAdminRole() || (Employee && biz)`, and isAdminRole() reads the EXISTING
// `role` claim. So Admin and Root are never affected by this backfill at all,
// and only an Employee can be caught between the rule shipping and their
// token refreshing (up to ~1h, or immediately on sign-out and back in).
//
// It reuses the function's own hasBusinessAccess() rather than reimplementing
// the predicate: that function is the security boundary, it is tested in
// functions/test/admin-claims-biz.test.js, and a second copy that drifted
// would grant or deny access the tests never looked at.

const path = require('path');
const {tenantPath} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId, getAuth, initializeApp,
  applicationDefault} = require('./lib/firestore-admin');

const functionsDir = path.join(__dirname, '..', 'functions');
// The COMPILED function - `npm --prefix functions run build` first.
const {hasBusinessAccess} =
  require(path.join(functionsDir, 'lib', 'admin-claims.functions'));

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId(
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);

  console.log(`project: ${projectId}${execute ? '   (WRITING)' : '   (dry run)'}\n`);

  const db = getFirestoreFor(projectId);
  const app = initializeApp(
    {credential: applicationDefault(), projectId}, `claims::${projectId}`);
  const auth = getAuth(app);

  const snap = await db.collection(tenantPath('admin_users')).get();
  const plan = [];

  for (const d of snap.docs) {
    const v = d.data();
    const uid = typeof v.firebaseUID === 'string' ? v.firebaseUID : '';
    const wanted = hasBusinessAccess(v.role, v.permissions);
    const grants = Array.isArray(v.permissions) ? v.permissions.length : 0;

    if (!uid) {
      console.log(`  ${(v.email || d.id).padEnd(34)} ${String(v.role).padEnd(9)} ` +
        'NO Auth account - skipped');
      continue;
    }

    let current;
    try {
      current = ((await auth.getUser(uid)).customClaims || {}).biz === true;
    } catch (err) {
      console.log(`  ${(v.email || d.id).padEnd(34)} ${String(v.role).padEnd(9)} ` +
        `Auth lookup failed (${err.code || err.message}) - skipped`);
      continue;
    }

    const change = current === wanted ? 'already correct' :
      `${current} -> ${wanted}`;
    console.log(`  ${(v.email || d.id).padEnd(34)} ${String(v.role).padEnd(9)} ` +
      `${grants} grants   biz: ${change}`);

    if (current !== wanted) {
      plan.push({uid, email: v.email || d.id, wanted});
    }
  }

  console.log(`\n${plan.length} account(s) to change, ${snap.size} seen.`);

  if (!execute) {
    console.log('Dry run. Re-run with --execute to write.');
    return;
  }

  for (const p of plan) {
    const user = await auth.getUser(p.uid);
    const claims = {...(user.customClaims || {})};
    if (p.wanted) {
      claims.biz = true;
    } else {
      delete claims.biz;
    }
    await auth.setCustomUserClaims(p.uid, claims);
    console.log(`  stamped ${p.email}: biz=${p.wanted}`);
  }
  console.log('\nWritten. A signed-in staff member picks the claim up on their');
  console.log('next token refresh (up to ~1h) or immediately on re-sign-in.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
