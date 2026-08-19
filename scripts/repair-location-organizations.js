// One-time (idempotent) hardening of `locations.organization` for the
// 2026-08 restructure (locations become child records of organizations):
//   1. Normalizes object-shaped `organization` values (old form saves stored
//      the whole OrganizationModel) down to the org's id string.
//   2. ORPHANS (no/unknown organization): the location IS the organization
//      (user decision 2026-08-19) - an org matching the location's
//      normalized name is linked if one exists, otherwise a new
//      organization is CREATED from the location itself (name, address,
//      phone, contactName split into a pointOfContact) and the location is
//      parented under it. ORPHAN_ASSIGNMENTS below overrides either
//      behavior per-doc (e.g. to point a misspelled location at the right
//      existing org instead of minting a misspelled org).
//   3. Reports anomalies (unnamed docs, duplicate-looking names) - never
//      auto-fixed.
//
//   node scripts/repair-location-organizations.js --project=dev [--dry-run]
//
// Run on dev 2026-08-19; REVIEW THE DRY-RUN WITH THE USER before the prod
// run (per the MIGRATION.md runbook).

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

// locationId -> existing organizations/{id} to link instead of the default
// match-or-create behavior.
const ORPHAN_ASSIGNMENTS = {
  // "First Baptist Chuech of Sun City" (misspelled location) is the same
  // church as the existing "First Baptist Church of Sun City" org - link it
  // there rather than minting a misspelled organization.
  'uCoouHW7yeCJLunqzXhH': 'Gh0MyXZ6qkZStUvEkO8r',
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

const norm = (s) => (s ?? '').trim().toLowerCase();

function pointOfContactFrom(contactName) {
  const name = (contactName ?? '').trim();
  if (!name) return undefined;
  const parts = name.split(/\s+/);
  return {
    firstName: parts[0],
    ...(parts.length > 1 ? { lastName: parts.slice(1).join(' ') } : {}),
  };
}

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
  const orgsByNorm = new Map();
  for (const d of orgSnap.docs) {
    const key = norm(d.data().name);
    if (key && !orgsByNorm.has(key)) orgsByNorm.set(key, d);
  }

  let normalized = 0;
  let linked = 0;
  let created = 0;
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
      // Orphan. Explicit override first, then name match, then "the
      // location IS the organization" - create one from it.
      const label = `${doc.id} "${data.name ?? '(unnamed)'}" (${data.address?.city ?? '?'}, ${data.address?.state ?? '?'})`;
      const override = ORPHAN_ASSIGNMENTS[doc.id];
      const nameMatch = orgsByNorm.get(norm(data.name));

      if (override) {
        if (!orgIds.has(override)) {
          console.error(`ORPHAN_ASSIGNMENTS[${doc.id}] -> '${override}' is not an existing organization; skipping`);
        } else {
          update.organization = override;
          linked++;
          console.log(`link (override) ${label} -> org '${override}'`);
        }
      } else if (!data.name) {
        anomalies.push(`${label}: has NO name - cannot create an org from it, decide manually`);
      } else if (nameMatch) {
        update.organization = nameMatch.id;
        linked++;
        console.log(`link (name match) ${label} -> org '${nameMatch.id}' "${nameMatch.data().name}"`);
      } else {
        const poc = pointOfContactFrom(data.contactName);
        const org = {
          name: data.name,
          contactName: data.contactName ?? '',
          address: data.address ?? {},
          phone: data.phone ?? {},
          ...(poc ? { pointOfContact: poc } : {}),
        };
        created++;
        console.log(`${dryRun ? '[dry-run] would create' : 'create'} org from ${label}: ${JSON.stringify({ name: org.name, contactName: org.contactName })}`);
        if (!dryRun) {
          const ref = await db.collection('organizations').add(org);
          update.organization = ref.id;
          orgIds.add(ref.id);
          orgsByNorm.set(norm(org.name), { id: ref.id, data: () => org });
          console.log(`  -> organizations/${ref.id}, location parented under it`);
        }
      }
    }

    if (!data.name && !anomalies.some((a) => a.startsWith(doc.id))) {
      anomalies.push(`${doc.id}: has NO name`);
    }

    if (Object.keys(update).length && !dryRun) {
      await doc.ref.update(update);
    }
  }

  // Duplicate-looking names (normalized compare) - report only, never auto-fix.
  const byNorm = new Map();
  for (const doc of locSnap.docs) {
    const key = norm(doc.data().name);
    if (!key) continue;
    byNorm.set(key, [...(byNorm.get(key) ?? []), doc.id]);
  }
  for (const [key, ids] of byNorm) {
    if (ids.length > 1) anomalies.push(`duplicate location name "${key}": ${ids.join(', ')}`);
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}normalized: ${normalized}, linked to existing orgs: ${linked}, orgs created from locations: ${created}`);
  if (anomalies.length) {
    console.log(`\nANOMALIES (manual cleanup candidates, not touched):`);
    anomalies.forEach((a) => console.log('  - ' + a));
  }
})().catch((e) => { console.error(e); process.exit(1); });
