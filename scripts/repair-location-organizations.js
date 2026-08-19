// One-time (idempotent) hardening of `locations.organization` for the
// 2026-08 restructure (locations become child records of organizations):
//   1. Normalizes object-shaped `organization` values (old form saves stored
//      the whole OrganizationModel) down to the org's id string.
//   2. Reports orphans (no/unknown organization) and data anomalies
//      (unnamed docs, duplicate-looking names) so the user can decide
//      per-doc; apply decisions via the ORPHAN_ASSIGNMENTS map below.
//
//   node scripts/repair-location-organizations.js --project=dev [--dry-run]
//
// ORPHAN_ASSIGNMENTS: locationId -> organizations/{id} to assign. Filled in
// after user review; unlisted orphans are left alone (reported every run).

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const ORPHAN_ASSIGNMENTS = {
  // 'locationDocId': 'organizationDocId',
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/repair-location-organizations.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));

  const [locSnap, orgSnap] = await Promise.all([
    db.collection('locations').get(),
    db.collection('organizations').get(),
  ]);
  const orgIds = new Set(orgSnap.docs.map((d) => d.id));
  const orgNames = orgSnap.docs.map((d) => `${d.id}  ${d.data().name ?? '(unnamed)'}`);

  let normalized = 0;
  let assigned = 0;
  const orphans = [];
  const anomalies = [];

  for (const doc of locSnap.docs) {
    const data = doc.data();
    const update = {};

    if (data.organization && typeof data.organization === 'object') {
      const id = data.organization.id;
      if (id && orgIds.has(id)) {
        update.organization = id;
        normalized++;
        console.log(`normalize ${doc.id} "${data.name ?? '(unnamed)'}": object -> '${id}'`);
      } else {
        anomalies.push(`${doc.id} "${data.name ?? '(unnamed)'}": object-shaped organization with missing/unknown id ${JSON.stringify(id)}`);
      }
    }

    const effectiveOrg = update.organization ?? (typeof data.organization === 'string' ? data.organization : undefined);
    if (!effectiveOrg || !orgIds.has(effectiveOrg)) {
      if (ORPHAN_ASSIGNMENTS[doc.id]) {
        const target = ORPHAN_ASSIGNMENTS[doc.id];
        if (!orgIds.has(target)) {
          console.error(`ORPHAN_ASSIGNMENTS[${doc.id}] -> '${target}' is not an existing organization; skipping`);
        } else {
          update.organization = target;
          assigned++;
          console.log(`assign ${doc.id} "${data.name ?? '(unnamed)'}" -> org '${target}'`);
        }
      } else {
        orphans.push(`${doc.id} "${data.name ?? '(unnamed)'}" (${data.address?.city ?? '?'}, ${data.address?.state ?? '?'}) organization=${JSON.stringify(data.organization ?? null)}`);
      }
    }

    if (!data.name) anomalies.push(`${doc.id}: has NO name`);

    if (Object.keys(update).length && !dryRun) {
      await doc.ref.update(update);
    }
  }

  // Duplicate-looking names (normalized compare) - report only, never auto-fix.
  const byNorm = new Map();
  for (const doc of locSnap.docs) {
    const norm = (doc.data().name ?? '').trim().toLowerCase();
    if (!norm) continue;
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), doc.id]);
  }
  for (const [norm, ids] of byNorm) {
    if (ids.length > 1) anomalies.push(`duplicate name "${norm}": ${ids.join(', ')}`);
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}normalized: ${normalized}, orphans assigned: ${assigned} of ${Object.keys(ORPHAN_ASSIGNMENTS).length} mapped`);
  if (orphans.length) {
    console.log(`\nORPHANS needing a user decision (add to ORPHAN_ASSIGNMENTS):`);
    orphans.forEach((o) => console.log('  - ' + o));
    console.log(`\nOrganizations available:`);
    orgNames.forEach((o) => console.log('  ' + o));
  }
  if (anomalies.length) {
    console.log(`\nANOMALIES (manual cleanup candidates, not touched):`);
    anomalies.forEach((a) => console.log('  - ' + a));
  }
})().catch((e) => { console.error(e); process.exit(1); });
