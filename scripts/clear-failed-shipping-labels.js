// Clears FAILED label attempts that were persisted onto purchase documents.
//
//   node scripts/clear-failed-shipping-labels.js --project=dev|prod [--execute]
//
// WHAT IS BEING CLEARED. `purchase.shippingLabel` is meant to hold a bought
// label - a labelId, a tracking number, a PDF link. Until 2026-09-02 the
// admin app assigned the FAILURE response to the same field, and because
// PurchasesService.update() is a whole-document setDoc of the in-memory
// order, the operator's very next workflow action (Received, Packaged) wrote
// that error blob onto the document. From then on the order read as "already
// has a label" on every screen and could never be labelled again.
//
// The client fix makes a stored failure retryable rather than terminal, so
// these orders are no longer stuck. This removes the wrong data anyway: it is
// not a label, the Purchases grid counts it as one, and leaving it means the
// next person to read the collection has to know this story.
//
// Only documents whose shippingLabel carries an error are touched - a real
// label has neither `code` nor `error`. Idempotent: a second run finds none.
//
// WHICH LAYOUT. dev keeps its collections under tenants/<id>/ and prod is
// still flat, so this probes both rather than trusting tenantPath() - a
// script that reads the wrong path reports "0 documents, nothing to do" and
// exits zero, which looks exactly like success. See the header of
// scripts/lib/tenancy.js.

const {resolveProjectId, getFirestoreFor} = require('./lib/firestore-admin');
const {tenantPath} = require('./lib/tenancy');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

/**
 * Finds the purchases collection this project actually uses.
 * @param {object} db A Firestore instance.
 * @return {Promise<string>} The collection path holding the documents.
 */
async function resolvePurchasesPath(db) {
  const nested = tenantPath('purchases');
  const [nestedSnap, flatSnap] = await Promise.all([
    db.collection(nested).limit(1).get(),
    db.collection('purchases').limit(1).get(),
  ]);
  if (!nestedSnap.empty) return nested;
  if (!flatSnap.empty) return 'purchases';
  throw new Error(
    `No purchases found at "${nested}" or "purchases" - refusing to report ` +
    'a clean run against a path that holds nothing.'
  );
}

(async () => {
  const project = arg('project');
  if (!project) {
    console.error(
      'Usage: node scripts/clear-failed-shipping-labels.js ' +
      '--project=dev|prod [--execute]'
    );
    process.exit(1);
  }
  const execute = !!arg('execute');
  const db = getFirestoreFor(resolveProjectId(project));

  const path = await resolvePurchasesPath(db);
  console.log(`project ${project} | reading ${path}`);

  const snap = await db.collection(path).get();
  const stranded = snap.docs.filter((d) => {
    const label = d.data().shippingLabel;
    return label && (label.code >= 400 || label.error);
  });

  console.log(`${snap.size} purchases, ${stranded.length} carrying a failure`);
  for (const doc of stranded) {
    const label = doc.data().shippingLabel;
    const message = label.error?.message ?? `code ${label.code}`;
    console.log(
      `  ${doc.id} [${doc.data().fulfillmentStatus ?? 'no status'}] ` +
      `${String(message).slice(0, 80)}`
    );
  }

  if (!stranded.length) {
    console.log('nothing to clear');
    return;
  }
  if (!execute) {
    console.log(
      `\n[dry-run] would clear shippingLabel on ${stranded.length} purchase(s). ` +
      'Re-run with --execute.'
    );
    return;
  }

  // FieldValue.delete() rather than writing null: the field should be absent,
  // which is what "no label yet" looks like everywhere else in the app, and
  // what the admin's own `if (!item.shippingLabel)` check reads.
  const {firestore} = require('./lib/firestore-admin');
  const batch = db.batch();
  stranded.forEach((doc) => batch.update(doc.ref, {
    shippingLabel: firestore.FieldValue.delete(),
  }));
  await batch.commit();
  console.log(`\ncleared ${stranded.length} purchase(s)`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
