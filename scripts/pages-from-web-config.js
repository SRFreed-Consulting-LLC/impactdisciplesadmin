#!/usr/bin/env node
/**
 * Turn the Privacy Policy and Terms of Use into ORDINARY PAGES.
 *
 *   node scripts/pages-from-web-config.js --project=dev
 *   node scripts/pages-from-web-config.js --project=dev --execute
 *
 * WHY. Both were tabs in Web Config - two rich-text fields, `policy` and
 * `tos`, each rendered by a bespoke web component at a hand-written route.
 * That made them the last two pages on the site that staff could edit the
 * WORDS of but nothing else: no heading, no picture, no second section, and
 * no way to see them beside every other page in the nav. Shane asked for them
 * to be pages with their own admin screens (2026-08-31), and every other page
 * on the site already is one.
 *
 * WHAT IT WRITES. One page_content document each, in the two-member
 * vocabulary the rest of the site now uses:
 *
 *   a HERO section - photo surface, the page's existing header image, the
 *     page title over it, exactly as the bespoke component drew it
 *   a SECTION - one column, held to a readable width, holding the rich text
 *     lifted from Web Config unchanged
 *
 * `title` is what marks a document as a page and gives the nav its leaf.
 * `isPublished` is deliberately absent: absent counts as published, and these
 * two pages are live today.
 *
 * IT DOES NOT DELETE `policy` OR `tos` from Web Config. The words would then
 * exist in exactly one place before anybody had looked at the new pages, and
 * the tabs are removed in the same release anyway - so the fields stay as a
 * silent copy until somebody deliberately clears them.
 *
 * ORDER THIS SHIPS IN, and it is not optional: the documents must exist
 * BEFORE the web build that stops serving the bespoke components, or both
 * pages render empty in the gap. Same rule the twelve-page cutover followed.
 *
 * DEV ONLY, dry-run by default, and it refuses a page that already exists
 * rather than writing over one somebody has since edited.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const PAGES = [
  {
    slug: 'private-policy',
    title: 'Privacy Policy',
    field: 'policy',
    image: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/'
      + 'Web-Pages%2FHeaders%2Fprivate-policy-header.PNG'
      + '?alt=media&token=46a75378-46f2-4cb3-9049-452c29cc7749'
  },
  {
    slug: 'terms',
    title: 'Terms of Use',
    field: 'tos',
    image: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/'
      + 'Web-Pages%2FHeaders%2Ftos-header.PNG'
      + '?alt=media&token=229807c4-6c51-44f1-89a5-4a89bde9c9f4'
  }
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
  console.error('REFUSED: dev only. Production gets these with its own release.');
  process.exit(1);
}

function blocksFor(page, html) {
  return [
    {
      key: 'pageHeader',
      type: 'section',
      variant: 'columns',
      surface: 'photo',
      // The header the bespoke component drew, kept so the page does not
      // change appearance the day it stops being bespoke.
      image: {url: page.image, name: page.title},
      isActive: true,
      columns: [{
        key: 'col-1',
        measure: true,
        pieces: [{key: 'heading-1-1', kind: 'heading', level: 'page', text: page.title, isActive: true}]
      }]
    },
    {
      key: 'body',
      type: 'section',
      variant: 'columns',
      surface: 'light',
      isActive: true,
      columns: [{
        key: 'col-1',
        // Held to a readable width. A privacy policy running the full width
        // of a desktop screen is the least readable thing on the site.
        measure: true,
        pieces: [{key: 'text-1-1', kind: 'text', html, isActive: true}]
      }]
    }
  ];
}

(async () => {
  const db = getFirestoreFor(projectId);
  const config = (await db.collection('config').get()).docs[0];
  if (!config) {
    console.error('REFUSED: no Web Config document to read the words out of.');
    process.exit(1);
  }

  let made = 0;
  let refused = 0;

  for (const page of PAGES) {
    const html = config.data()[page.field];
    console.log('\n### ' + page.slug + '  <- webConfig.' + page.field);

    if (!html || !String(html).trim()) {
      console.error('  REFUSED: Web Config has nothing in ' + page.field + '.');
      refused++;
      continue;
    }

    const ref = db.collection('page_content').doc(page.slug);
    const existing = await ref.get();
    if (existing.exists && existing.data().title) {
      console.error('  REFUSED: a page already exists at this slug. Not writing over it.');
      refused++;
      continue;
    }

    const blocks = blocksFor(page, html);
    console.log('  title  : ' + page.title);
    console.log('  words  : ' + String(html).replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').length + ' words carried across');
    console.log('  blocks : hero over its header photo, then the text');

    if (execute) {
      await ref.set({
        title: page.title,
        theme: {surface: 'light', banding: false},
        blocks
      }, {merge: true});
      console.log('  WRITTEN.');
    }
    made++;
  }

  console.log('\n' + made + ' page(s) ready, ' + refused + ' refused.');
  if (!execute && made) {
    console.log('DRY RUN. Re-run with --execute to write.');
  } else if (execute && made) {
    console.log(
      '\nWritten. The web app must now STOP serving these from its own\n'
      + 'components - until it does, the hand-written routes win and the new\n'
      + 'documents are not reached.'
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
