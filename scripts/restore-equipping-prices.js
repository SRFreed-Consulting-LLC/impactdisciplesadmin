#!/usr/bin/env node
/**
 * Put the equipping group's PRICES back on the equipping pages.
 *
 *   node scripts/restore-equipping-prices.js --project=dev
 *   node scripts/restore-equipping-prices.js --project=dev --execute
 *
 * A REGRESSION, found on 2026-08-31 while auditing Web Config for fields
 * nothing reads. equippingGroupTotalCost and equippingGroupPaymentCost looked
 * like two more dead settings - offered in the price picker, named by no page
 * - and they are not. The pre-cutover template rendered them:
 *
 *   <h6>Save with Full Payment: ${{webConfig.equippingGroupTotalCost}}</h6>
 *   <p><i>One-time payment for all 7 weeks...</i></p>
 *   <h6>4 Month Plan: ${{webConfig.equippingGroupPaymentCost}}/month</h6>
 *   <p><i>Join the 7-week live Zoom equipping series...</i></p>
 *
 * The four-page cutover on 2026-08-30 dropped those lines. Nothing threw,
 * every word of the surrounding copy survived, and the page has simply been
 * missing its cost section since - which is exactly the failure mode the
 * comparison screen was later built to catch, and this predates it.
 *
 * WHAT IT ADDS. A COST section on the equipping-groups page: a heading, and
 * two price pieces NAMING the two Web Config figures with the same wording
 * the template used. Named, never typed - so the price stays in one place and
 * changing it in Web Config changes the page, which is the whole rule.
 *
 * Placed after `overview` and before `courses`, where the original had it.
 *
 * Added SWITCHED OFF. This restores something that has been missing for a
 * day; somebody should look at it before visitors do.
 *
 * DEV ONLY, dry-run by default, refuses a page that already has a cost
 * section.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const SLUG = 'equipping-groups';
const KEY = 'cost';

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

const section = {
  key: KEY,
  type: 'section',
  variant: 'columns',
  surface: 'light',
  // OFF - see the header. It has been missing for a day; one more hour
  // while somebody looks at it costs nothing.
  isActive: false,
  columns: [{
    key: 'col-1',
    measure: true,
    pieces: [
      {key: 'heading-1-1', kind: 'heading', level: 'section', text: 'COST', isActive: true},
      {
        key: 'text-1-1', kind: 'text', isActive: true,
        html: '<p>We offer 2 options to pay for this service:</p>'
      },
      {
        key: 'heading-1-2', kind: 'heading', level: 'minor',
        text: 'Save with Full Payment', isActive: true
      },
      // NAMED, never typed. The figure lives in Web Config and the piece
      // asks for it, so the price exists in exactly one place.
      {key: 'price-1-1', kind: 'price', amountKey: 'equippingGroupTotalCost', isActive: true},
      {
        key: 'text-1-2', kind: 'text', isActive: true,
        html: '<p><i>One-time payment for all 7 weeks of live, interactive Zoom '
          + 'sessions plus bonus materials.</i></p>'
      },
      {
        key: 'heading-1-3', kind: 'heading', level: 'minor',
        text: '4 Month Plan', isActive: true
      },
      {
        key: 'price-1-2', kind: 'price', amountKey: 'equippingGroupPaymentCost',
        amountSuffix: '/month', isActive: true
      },
      {
        key: 'text-1-3', kind: 'text', isActive: true,
        html: '<p><i>Join the 7-week live Zoom equipping series on a 4-month '
          + 'billing plan.</i></p>'
      }
    ]
  }]
};

(async () => {
  const db = getFirestoreFor(projectId);
  const ref = db.collection('page_content').doc(SLUG);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error('REFUSED: no ' + SLUG + ' page.');
    process.exit(1);
  }

  const blocks = doc.data().blocks ?? [];
  if (blocks.some((b) => b.key === KEY)) {
    console.error('REFUSED: ' + SLUG + ' already has a "' + KEY + '" section.');
    process.exit(1);
  }

  // Where the original had it: after the overview, before the course rows.
  const at = blocks.findIndex((b) => b.key === 'courses');
  const index = at === -1 ? blocks.length : at;

  const next = [...blocks];
  next.splice(index, 0, section);

  console.log('page   : ' + SLUG);
  console.log('adding : COST, at position ' + index + ' of ' + blocks.length);
  console.log('         heading + text + 2 named prices + their two notes');
  console.log('         switched OFF');
  console.log('order  : ' + next.map((b) => b.key).join(' -> '));

  if (!execute) {
    console.log('\nDRY RUN. Re-run with --execute to write.');
    process.exit(0);
  }

  await ref.update({blocks: next});
  console.log('\nWritten. Switch it on once it looks right.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
