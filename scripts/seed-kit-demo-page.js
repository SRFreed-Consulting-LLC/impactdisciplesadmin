#!/usr/bin/env node
// Seeds `page_content/kit-demo` - a page that exists ONLY to be looked at
// (2026-08-30).
//
//   node scripts/seed-kit-demo-page.js --project=dev
//   node scripts/seed-kit-demo-page.js --project=dev --execute
//   node scripts/seed-kit-demo-page.js --project=dev --execute --force
//   node scripts/seed-kit-demo-page.js --project=dev --execute --remove
//
// Dry-run by default, like every script in this folder.
//
// WHY IT EXISTS. The section kit has specs proving each archetype draws
// SOMETHING, which is a very low bar - it catches a missing case, not a bad
// layout. Nothing so far has put a kit page in front of a person. This is
// that page: every implemented archetype, every implemented variant, and all
// four surfaces, with real copy rather than lorem so the typography is
// judged on something honest.
//
// IT IS A PROPER STAFF-CREATED PAGE, not a fixture. It has a `title`, which
// is what tells the web app a document is a builder page rather than one of
// the twelve originals, so it proves the whole path: no route was written for
// it, no component, no nav entry. It exists because the document exists.
//
// DEV ONLY. There is no reason for a demo page on the production site, and
// --project=prod is refused below rather than merely discouraged.
//
// TO SEE IT you need the web app running from the `feature/section-kit`
// branch - the dynamic route does not exist on `development` and is not
// deployed anywhere:
//
//   cd "../impactdisciples - web" && npm run start-dev
//   http://localhost:4200/kit-demo
//
// REMOVING IT is one flag: --remove. Nothing links to it, so it is invisible
// to a visitor who does not type the URL, but it should not outlive the
// review it was made for.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const COLLECTION = 'page_content';
const DOC_ID = 'kit-demo';

// Real assets from the existing pages. Public download tokens, so they load
// wherever this is seeded - a demo with broken images tells you nothing about
// the layout.
const IMG = {
  hero: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FHeaders%2Fseminars-header.PNG?alt=media&token=a3d6bae8-00d0-43d3-ae8e-8ab356ce1cfc',
    name: 'Headers/seminars-header'
  },
  band: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FHeaders%2Fhistory-header.PNG?alt=media&token=f3e35d82-8571-4cee-8a7a-db7894d21578',
    name: 'Headers/history-header'
  },
  map: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FShared%2Fmap.jpg?alt=media&token=9db9c6f4-c852-4722-807e-5fa5d93f881a',
    name: 'Shared/map'
  },
  one: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FHome%2Fstory-1.PNG?alt=media&token=c1daf9a0-35db-4a1e-b502-71d23c701762',
    name: 'Home/story-1'
  },
  two: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FHome%2Fstory-2.jpg?alt=media&token=35028e2e-f4fe-40ca-8d92-042b2cda016d',
    name: 'Home/story-2'
  },
  three: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Web-Pages%2FHome%2Fstory-3.jpg?alt=media&token=4a367383-4b7e-4a9a-a696-934086475cd0',
    name: 'Home/story-3'
  }
};

const entry = (e) => Object.assign({isActive: true}, e);

const BLOCKS = [
  // --------------------------------------------------- heroBand / photo
  {
    key: 'hero', type: 'heroBand', variant: 'standard', surface: 'photo', isActive: true,
    subheading: 'Section kit',
    heading: 'A page nobody wrote a component for',
    body: '<p>Every band below is drawn by one shared renderer. No route was written for this page, no component, no nav entry - it exists because a document exists.</p>',
    ctaTitle: 'See the sections', ctaUrl: '#',
    ctaTitle2: 'Back to the site', ctaUrl2: '/'
  },

  // ----------------------------------------- copyCentred / plain / light
  {
    key: 'intro', type: 'copyCentred', variant: 'plain', surface: 'light', isActive: true,
    heading: 'What you are looking at',
    body: '<p>Five archetypes, eleven variants and all four surfaces, on one page. '
      + 'The <strong>variant</strong> is structural - whether a video sits beside the copy or under it. '
      + 'The <strong>surface</strong> is only colour. Keeping them apart is what stops every new '
      + 'shade of band becoming a new kind of section.</p>'
      + '<p>Read it as a range of what the kit can draw, not as a page anyone would publish.</p>'
  },

  // ------------------------------------------ copyMedia / image / light
  {
    key: 'copy-image', type: 'copyMedia', variant: 'image', surface: 'light', isActive: true,
    subheading: 'Copy beside media',
    heading: 'A passage beside a picture',
    body: '<p>The largest family on the site: nine of the forty-nine sections across the twelve '
      + 'existing pages are some version of this.</p>'
      + '<ul><li>The picture side alternates by position</li>'
      + '<li>Nothing stores which side it landed on</li>'
      + '<li>So reordering can never stack two the same way</li></ul>',
    image: IMG.one,
    ctaTitle: 'A button, optionally', ctaUrl: '#'
  },

  // ------------------------------------------- copyMedia / video / dark
  {
    key: 'copy-video', type: 'copyMedia', variant: 'video', surface: 'dark', isActive: true,
    subheading: 'The same section, different ground',
    heading: 'Copy beside a video',
    body: '<p>Identical layout to the band above it. The only thing that changed is the surface - '
      + 'and that is the entire argument for splitting colour from structure.</p>'
      + '<p>The video is click-to-play: the player is only created on the click, so a page of '
      + 'these costs one request rather than an iframe per section.</p>',
    image: IMG.map,
    videoId: 'HxKSa24hF60'
  },

  // ---------------------------------------- listGrid / picture / light
  {
    key: 'tiles-picture', type: 'listGrid', variant: 'picture', surface: 'light', isActive: true,
    heading: 'Picture tiles',
    body: '<p>One list control edits every kind of list; a variant only says which columns of it to show.</p>',
    items: [
      entry({title: 'Equipping Groups', description: 'Twelve weeks, six men, one table.', image: IMG.one}),
      entry({title: 'Seminars', description: 'A day that starts something.', image: IMG.two}),
      entry({title: 'Coaching', description: 'The part that happens afterwards.', image: IMG.three})
    ]
  },

  // ------------------------------------------ listGrid / icon / tinted
  {
    key: 'tiles-icon', type: 'listGrid', variant: 'icon', surface: 'tinted', isActive: true,
    heading: 'Icon tiles, on the brand tint',
    items: [
      entry({title: 'Give once', body: '<p>A single gift, whenever it suits.</p>', icon: 'fas fa-heart', ctaTitle: 'Give', ctaUrl: '#'}),
      entry({title: 'Give monthly', body: '<p>The gifts that let us plan past next month.</p>', icon: 'fas fa-calendar-days', ctaTitle: 'Partner', ctaUrl: '#'}),
      entry({title: 'Pray', body: '<p>Costs nothing and changes most.</p>', icon: 'fas fa-hands-praying', ctaTitle: 'Join', ctaUrl: '#'})
    ]
  },

  // ------------------------------------------- listGrid / price / light
  {
    key: 'tiles-price', type: 'listGrid', variant: 'price', surface: 'light', isActive: true,
    heading: 'Price tiles',
    body: '<p>The AMOUNT is not stored on the tile. It names a figure from the site settings and '
      + 'the page resolves it, so a price only ever lives in one place.</p>',
    items: [
      entry({title: 'In person', amountKey: 'inpersonSeminarCost', body: '<p>A full day, materials, and lunch.</p>', ctaTitle: 'Book', ctaUrl: '#'}),
      entry({title: 'Online', amountKey: 'onlineSeminarCost', amountSuffix: '/seat', body: '<p>The same training, from wherever you are.</p>', ctaTitle: 'Book', ctaUrl: '#'})
    ]
  },

  // ------------------------------------------- photoBand / title / photo
  {
    key: 'band-title', type: 'photoBand', variant: 'title', surface: 'photo', isActive: true,
    heading: 'A line across a photograph',
    image: IMG.band
  },

  // ------------------------------------------ photoBand / figure / photo
  {
    key: 'band-figure', type: 'photoBand', variant: 'figure', surface: 'photo', isActive: true,
    heading: '17',
    subheading: 'countries',
    body: '<p>The figure treatment: a large number on one side and a paragraph on the other. '
      + 'Same band, different arrangement - which makes it a variant rather than a surface.</p>',
    image: IMG.map
  },

  // ------------------------------------ copyCentred / mediaBelow / light
  {
    key: 'report', type: 'copyCentred', variant: 'mediaBelow', surface: 'light', isActive: true,
    subheading: 'A structural difference',
    heading: 'Centred copy, then the video',
    body: '<p>The video is below the copy rather than beside it. No amount of styling turns the '
      + 'band above into this one, which is exactly the test for whether something is a variant.</p>',
    image: IMG.map,
    videoId: 'HxKSa24hF60',
    ctaTitle: 'And a button under that', ctaUrl: '#'
  },

  // ----------------------------------- copyCentred / withButtons / tinted
  {
    key: 'closing', type: 'copyCentred', variant: 'withButtons', surface: 'tinted', isActive: true,
    heading: 'The closing block',
    body: '<p>On the twelve existing pages this exact section is a <code>banner</code> on Coaching '
      + 'and a <code>prose</code> on the Discipleship Library - same fields, same label, two '
      + 'different types, purely because they could not share a name on one page. Here it is one '
      + 'section on a tinted surface.</p>',
    ctaTitle: 'Primary', ctaUrl: '#',
    ctaTitle2: 'Secondary', ctaUrl2: '#'
  }
];

const PAGE = {
  title: 'Section Kit Demo',
  // Light, so the dark and tinted bands below are visibly OVERRIDES rather
  // than the page's own colour - which is the thing worth seeing.
  theme: {surface: 'light', banding: false},
  isPublished: true,
  blocks: BLOCKS
};

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const force = args.includes('--force');
  const remove = args.includes('--remove');
  // resolveProjectId takes the VALUE, not the argv array. Passing the array
  // made it return '--project=dev' unchanged - which then sailed past the
  // production guard below, because that string matches neither pattern. The
  // guard was decorative until this line was fixed.
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const projectId = resolveProjectId(projectArg);

  // A demo page has no business on the production site, and "be careful" is
  // not a control.
  if (/a82a8|prod/i.test(projectId)) {
    console.error('REFUSED: this script is dev-only. ' + projectId + ' looks like production.');
    process.exit(1);
  }

  const db = getFirestoreFor(projectId);
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const existing = await ref.get();

  console.log('project   : ' + projectId);
  console.log('document  : ' + COLLECTION + '/' + DOC_ID);
  console.log('exists    : ' + existing.exists);
  console.log('sections  : ' + BLOCKS.length);
  console.log('archetypes: ' + [...new Set(BLOCKS.map((b) => b.type))].join(', '));
  console.log('variants  : ' + [...new Set(BLOCKS.map((b) => b.type + '/' + b.variant))].length);
  console.log('surfaces  : ' + [...new Set(BLOCKS.map((b) => b.surface))].join(', '));

  if (remove) {
    if (!execute) {
      console.log('\nDRY RUN. Would DELETE the document. Re-run with --execute --remove.');
      return;
    }
    await ref.delete();
    console.log('\nDeleted.');
    return;
  }

  if (existing.exists && !force) {
    console.log('\nSKIPPED: the document already exists. --force overwrites it.');
    return;
  }

  if (!execute) {
    console.log('\nDRY RUN. Nothing written. Re-run with --execute.');
    console.log('Then view it at http://localhost:4200/' + DOC_ID
      + ' with the web app on the feature/section-kit branch.');
    return;
  }

  await ref.set(PAGE);
  console.log('\nWritten. View it at http://localhost:4200/' + DOC_ID
    + ' (web app on feature/section-kit).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
