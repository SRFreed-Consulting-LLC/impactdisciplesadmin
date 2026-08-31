#!/usr/bin/env node
/**
 * Web Config: seed the logo, drop the fields nothing reads.
 *
 *   node scripts/web-config-cleanup.js --project=dev
 *   node scripts/web-config-cleanup.js --project=dev --execute
 *
 * FROM THE AUDIT of 2026-08-31, which traced every field in this document
 * across the web app, the admin, the reader and the Cloud Functions.
 *
 * SEEDS `logo`. The site header draws a HARDCODED url out of a source file
 * only a developer can edit, so the field has never done anything. Seeding it
 * with the url the header currently uses means switching the header over
 * changes nothing on screen - and makes the logo editable for the first time.
 * The web build that reads it must ship AFTER this runs, or the header has
 * nothing to draw.
 *
 * DROPS FOUR FIELDS that nothing anywhere reads:
 *
 *   countdownEndDateTime  the home page's countdown takes its date from the
 *                         summit event, never from here
 *   images                a list of urls nothing draws
 *   adminEmailAddress     a box on the form; no email is sent to it by any
 *                         app or function
 *   taxImportDate         converted from a Timestamp on every read and then
 *                         never looked at - a leftover from when tax rates
 *                         were imported rather than fetched
 *
 * IT DOES NOT TOUCH `policy` OR `tos`. Those hold the Privacy Policy and
 * Terms wording, which is now also on two pages - they stay as a second copy
 * until somebody has read the new pages and says otherwise.
 *
 * DEV ONLY, dry-run by default, and a re-run finds nothing left to do.
 */
// firebase-admin resolves out of functions/node_modules, which this bootstrap
// does - a bare require('firebase-admin/firestore') from scripts/ does not
// resolve at all. It re-exports the whole modular module as `firestore`.
const {getFirestoreFor, resolveProjectId, firestore} = require('./lib/firestore-admin');
const {FieldValue} = firestore;

/** What the site header draws today, out of impact-disciples.data.ts. */
const CURRENT_LOGO = 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/'
  + 'o/Logos%2FImpact-Logo_Black.png?alt=media&token=2a2452b7-a337-476f-b268-d0a4b0fa5d42';

const DEAD = ['countdownEndDateTime', 'images', 'adminEmailAddress', 'taxImportDate'];

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

if (!projectArg) {
  console.error('Missing --project=dev. There is no default.');
  process.exit(1);
}
const projectId = resolveProjectId(projectArg);

if (/a82a8/.test(projectId) || projectArg === 'prod') {
  console.error('REFUSED: dev only. Production gets this with its own release.');
  process.exit(1);
}

(async () => {
  const db = getFirestoreFor(projectId);
  const snap = await db.collection('config').get();
  if (snap.empty) {
    console.error('REFUSED: no Web Config document.');
    process.exit(1);
  }

  let changed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    const said = [];

    // The header's url, unless somebody has already put one here - in which
    // case theirs wins and this leaves it alone.
    if (!data.logo || !String(data.logo).trim()) {
      update.logo = CURRENT_LOGO;
      said.push('logo seeded with the header\'s current image');
    } else if (data.logo !== CURRENT_LOGO) {
      said.push('logo already set to something else - LEFT ALONE');
    }

    for (const field of DEAD) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        update[field] = FieldValue.delete();
        said.push('dropped ' + field);
      }
    }

    if (!said.length) {
      continue;
    }
    changed++;
    console.log('\n' + doc.id);
    said.forEach((line) => console.log('  ' + line));

    if (execute && Object.keys(update).length) {
      await doc.ref.update(update);
      console.log('  WRITTEN.');
    }
  }

  console.log('\n' + changed + ' document(s) to change.');
  if (!changed) {
    console.log('Nothing to do.');
  } else if (!execute) {
    console.log('DRY RUN. Re-run with --execute to write.');
  } else {
    console.log(
      '\nWritten. The web build that reads webConfig.logo can ship now - not\n'
      + 'before, or the site header would have had nothing to draw.'
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
