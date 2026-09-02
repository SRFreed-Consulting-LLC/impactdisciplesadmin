#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
/**
 * Type the equipping-group prices into the headings, and retire the two
 * Web Config figures they used to come from.
 *
 *   node scripts/equipping-prices-into-text.js --project=dev
 *   node scripts/equipping-prices-into-text.js --project=dev --execute
 *
 * WHAT WAS ACTUALLY WRONG, after two wrong diagnoses. Nothing was missing
 * from these pages: the whole COST block - the heading, the "we offer 2
 * options" line, both plan headings and both explanatory notes - came across
 * the cutover intact, in the left column where production has it. What the
 * migration dropped was the two BINDINGS inside two heading lines, so
 * "Save with Full Payment: ${{webConfig.equippingGroupTotalCost}}" became
 * "Save with Full Payment".
 *
 * Two figures on two pages. Not a missing section, and nothing at all wrong
 * with Equipping Groups or Equipping - Leaders.
 *
 * WHY THEY ARE TYPED rather than named. Shane's call, and the trade is worth
 * recording: naming a Web Config figure keeps a price in one place, which is
 * why the seminar prices still do it. These two are read by nothing else on
 * the site - one sentence on two pages - so a setting existing purely to
 * feed them is a lever nobody will remember, and the pages already carry
 * every other word of that block as text. The fields go with the binding;
 * leaving them would be exactly the dead-setting problem the audit was about.
 *
 * DEV ONLY, dry-run by default, and it refuses a heading that already
 * carries a figure.
 */
const {getFirestoreFor, resolveProjectId, firestore} = require('./lib/firestore-admin');
const {FieldValue} = firestore;

const PAGES = ['equipping-groups-churches', 'equipping-groups-pastors'];
const FIELDS = ['equippingGroupTotalCost', 'equippingGroupPaymentCost'];

/** heading text -> how production writes it, once the figure is in. */
const REWRITES = [
  {from: 'Save with Full Payment', field: 'equippingGroupTotalCost', suffix: ''},
  {from: '4 Month Plan', field: 'equippingGroupPaymentCost', suffix: '/month'}
];

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

if (!projectArg) {
  console.error('Missing --project=dev. There is no default.');
  process.exit(1);
}
const projectId = resolveProjectId(projectArg);

if (/a82a8/.test(projectId) || projectArg === 'prod') {
  console.error('REFUSED: dev only.');
  process.exit(1);
}

(async () => {
  const db = getFirestoreFor(projectId);
  const configDoc = (await tenantCollection(db, "config").get()).docs[0];
  const config = configDoc.data();

  // Read the figures BEFORE removing them - they are the only copy.
  const values = {};
  for (const field of FIELDS) {
    if (typeof config[field] !== 'number') {
      console.error('REFUSED: ' + field + ' is not a number in Web Config. '
        + 'It is the only copy of the price and this would type a blank.');
      process.exit(1);
    }
    values[field] = config[field];
  }
  console.log('figures: ' + FIELDS.map((f) => f + '=' + values[f]).join(', '));

  let edits = 0;

  for (const slug of PAGES) {
    const ref = tenantCollection(db, "page_content").doc(slug);
    const blocks = (await ref.get()).data()?.blocks ?? [];
    const changed = [];

    for (const block of blocks) {
      for (const column of block.columns ?? []) {
        for (const piece of column.pieces ?? []) {
          if (piece.kind !== 'heading') {
            continue;
          }
          const rule = REWRITES.find((r) => (piece.text ?? '').trim() === r.from);
          if (!rule) {
            continue;
          }
          const next = rule.from + ': $' + values[rule.field] + rule.suffix;
          changed.push(JSON.stringify(piece.text) + '  ->  ' + JSON.stringify(next));
          piece.text = next;
        }
      }
    }

    console.log('\n### ' + slug);
    if (!changed.length) {
      console.log('  nothing to rewrite - already carries its figures, or the '
        + 'headings have been edited.');
      continue;
    }
    changed.forEach((line) => console.log('  ' + line));
    edits += changed.length;

    if (execute) {
      await ref.update({blocks});
      console.log('  WRITTEN.');
    }
  }

  console.log('\n### Web Config');
  const present = FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(config, f));
  if (!present.length) {
    console.log('  both figures already gone.');
  } else {
    present.forEach((f) => console.log('  dropping ' + f + ' (' + config[f] + ')'));
  }

  if (!execute) {
    console.log('\nDRY RUN. Re-run with --execute to write.');
    process.exit(0);
  }

  // AFTER the pages carry the numbers, never before - these fields are the
  // only place either figure exists.
  if (present.length) {
    if (!edits && present.length) {
      console.log('\n  Headings were not rewritten this run, so the figures stay'
        + ' where they are. Nothing else to do.');
      process.exit(0);
    }
    const update = {};
    present.forEach((f) => (update[f] = FieldValue.delete()));
    await configDoc.ref.update(update);
    console.log('  WRITTEN.');
  }

  console.log('\nDone. The two figures now live in the page text and nowhere else.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
