#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
/**
 * Put the COST section on the equipping pages that ACTUALLY had one, and
 * take it off the one that did not.
 *
 *   node scripts/fix-equipping-prices.js --project=dev
 *   node scripts/fix-equipping-prices.js --project=dev --execute
 *
 * CORRECTS AN EARLIER FIX. On 2026-08-31 the two equipping-group price
 * fields looked dead - offered in the price picker, named by no page - and a
 * COST section was restored to `equipping-groups` on the strength of a
 * template found in git history.
 *
 * IT WAS THE WRONG TEMPLATE. The search took the OLDEST commit touching the
 * field and read a 2025 file, rather than the commit production was actually
 * deployed from. Shane caught it in one line: "in the equipping groups on
 * prod, there is no price section."
 *
 * What production really deploys (commit d818d6c, 2026-08-23) shows COST on
 * TWO OTHER PAGES and not on that one:
 *
 *   equipping-groups-churches   COST, both figures
 *   equipping-groups-pastors    COST, both figures
 *   equipping-groups            none
 *   equipping-groups-leaders    none
 *
 * So this removes the section that was invented and adds the two that were
 * genuinely lost in the cutover. The wording and both notes are the
 * template's own, and the figures are NAMED rather than typed, so the price
 * still lives in one place.
 *
 * Placed after `overview`, where the prose block that carried it sat.
 *
 * DEV ONLY, dry-run by default, and each half refuses if the page is not in
 * the state it expects.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const ADD_TO = ['equipping-groups-churches', 'equipping-groups-pastors'];
const REMOVE_FROM = 'equipping-groups';
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

/** The COST block, word for word from the production template. */
function costSection() {
  return {
    key: KEY,
    type: 'section',
    variant: 'columns',
    surface: 'light',
    isActive: true,
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
}

(async () => {
  const db = getFirestoreFor(projectId);
  let changes = 0;

  // ---------------------------------------------------- take the wrong one off
  {
    const ref = tenantCollection(db, "page_content").doc(REMOVE_FROM);
    const blocks = (await ref.get()).data()?.blocks ?? [];
    const at = blocks.findIndex((b) => b.key === KEY);
    console.log('\n### ' + REMOVE_FROM);
    if (at === -1) {
      console.log('  no cost section - nothing to undo.');
    } else {
      console.log('  REMOVING the cost section - this page never had one');
      const next = blocks.filter((b) => b.key !== KEY);
      console.log('  order: ' + next.map((b) => b.key).join(' -> '));
      changes++;
      if (execute) {
        await ref.update({blocks: next});
        console.log('  WRITTEN.');
      }
    }
  }

  // -------------------------------------------------- put it where it belongs
  for (const slug of ADD_TO) {
    const ref = tenantCollection(db, "page_content").doc(slug);
    const doc = await ref.get();
    console.log('\n### ' + slug);
    if (!doc.exists) {
      console.error('  REFUSED: no such page.');
      continue;
    }
    const blocks = doc.data().blocks ?? [];
    if (blocks.some((b) => b.key === KEY)) {
      console.log('  already has a cost section - leaving it alone.');
      continue;
    }
    // After the overview, where the prose block that carried it sat.
    const at = blocks.findIndex((b) => b.key === 'overview');
    const index = at === -1 ? blocks.length : at + 1;
    const next = [...blocks];
    next.splice(index, 0, costSection());
    console.log('  ADDING cost at position ' + index);
    console.log('  order: ' + next.map((b) => b.key).join(' -> '));
    changes++;
    if (execute) {
      await ref.update({blocks: next});
      console.log('  WRITTEN.');
    }
  }

  console.log('\n' + changes + ' page(s) to change.');
  if (!changes) {
    console.log('Nothing to do.');
  } else if (!execute) {
    console.log('DRY RUN. Re-run with --execute to write.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
