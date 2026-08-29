#!/usr/bin/env node
// Seeds `home_sections` with the six sections the public home page has
// always rendered, in the order a visitor meets them (2026-08-29).
//
// Until now the home page was a fixed stack of components with their copy,
// images and links written into the templates. This puts that same content
// into Firestore so staff can reorder it, switch a section off, add another
// banner, and edit what is inside each - without a deploy.
//
//   node scripts/seed-home-sections.js --project=dev
//   node scripts/seed-home-sections.js --project=dev --execute
//
// Dry-run by default, like every script in this folder.
//
// IDEMPOTENT, AND IT WILL NOT OVERWRITE STAFF EDITS. Document ids are
// deterministic, and a section that already exists is SKIPPED rather than
// rewritten - re-running after someone has edited the copy leaves their
// version alone. Use --force only to deliberately reset a section back to
// the shipped defaults.
//
// ORDER OF OPERATIONS: the `home_sections` rule must be deployed before the
// web build that reads this data. Web falls back to a hardcoded stack if the
// read is denied, so the wrong order is a stale home page rather than a
// broken one - but it is still the wrong order.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const COLLECTION = 'home_sections';

const STORAGE =
  'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/';

// The six sections, in page order. `order` is written from this array's
// position rather than typed, which is the same rule the admin's drag
// handles follow - see HomeSectionModel.
const SECTIONS = [
  {
    id: 'home-slider',
    type: 'slider',
    isActive: true,
    // No content of its own. The SLIDES live in `home_page_images`; this
    // record only says where the carousel sits and whether it shows.
  },
  {
    id: 'home-services',
    type: 'services',
    isActive: true,
    items: [
      {
        image: {
          name: 'service-seminars',
          url: STORAGE + 'Web-Pages%2FHome%2Fservice-seminars.PNG?alt=media&token=ec3a4fd3-5364-40b7-82d4-42898a5c2d81',
        },
        title: 'SEMINARS',
        description: 'Host a Disciple-Making Church seminar for your ministry',
        link: '/seminars',
        isActive: true,
      },
      {
        image: {
          name: 'service-consultation',
          url: STORAGE + 'Web-Pages%2FHome%2Fservice-consultation.PNG?alt=media&token=ad3369ad-87ee-495c-8579-a04551bd6939',
        },
        title: 'Training',
        description: 'Schedule your first consultation on us',
        link: '/equipping-groups',
        isActive: true,
      },
      {
        image: {
          name: 'service-support-our-mission',
          url: STORAGE + 'Web-Pages%2FHome%2Fservice-support-our-mission.PNG?alt=media&token=4f49643b-4193-4940-9bd7-d0c8360245c7',
        },
        title: 'SUPPORT OUR MISSION',
        description: 'Partner with us by praying and giving',
        link: '/give',
        isActive: true,
      },
      {
        image: {
          name: 'service-connect-with-us',
          url: STORAGE + 'Web-Pages%2FHome%2Fservice-connect-with-us.PNG?alt=media&token=be61d4b9-6349-4022-bd0e-6f1d0603025f',
        },
        title: 'CONNECT WITH US',
        description: 'Let us know how we can support your ministry',
        link: '/contact',
        isActive: true,
      },
    ],
  },
  {
    id: 'home-summit-banner',
    type: 'summitBanner',
    isActive: true,
    // The countdown and the register link come from the summit EVENT, not
    // from here - only the presentation is editable.
    title: 'DISCIPLE-MAKING SUMMIT',
    ctaTitle: 'REGISTER NOW',
    image: {
      name: 'summit-banner-large',
      url: STORAGE + 'Web-Pages%2FShared%2Fsummit-banner-large.PNG?alt=media&token=74f6f522-2b3e-48f0-bdb9-2b363abbe80e',
    },
  },
  {
    id: 'home-video',
    type: 'video',
    isActive: true,
    title: 'OUR VISION',
    subtitle:
      'Impact Discipleship Ministries exists to inspire people and churches ' +
      'to be and build disciples of Jesus Christ.',
    videoId: 'HxKSa24hF60',
    videoUrl: 'https://www.youtube.com/watch?v=HxKSa24hF60',
    image: {
      name: 'map',
      url: STORAGE + 'Web-Pages%2FShared%2Fmap.jpg?alt=media&token=9db9c6f4-c852-4722-807e-5fa5d93f881a',
    },
  },
  {
    id: 'home-book-banner',
    type: 'banner',
    isActive: true,
    // The heading carries <strong> markup and is rendered with innerHTML,
    // the same way the services cards' titles already were.
    title: 'DISCOVER <strong>POWERFUL</strong> DISCIPLE-MAKING RESOURCES',
    subtitle:
      'Explore our store for impactful resources crafted to guide your ' +
      'disciple-making efforts. Our collection of books is designed to ' +
      'provide practical tools and biblical insights that will deepen your ' +
      'faith and extend your impact. Start your journey today with the ' +
      'perfect resource.',
    ctaTitle: 'VISIT OUR STORE',
    ctaDestination: '/store',
    image: {
      name: 'DMC-Series_Five-Images-1',
      url: STORAGE + 'Store%2FDMC-Series_Five-Images-1.png?alt=media&token=97f755c0-3c73-4545-979c-6428c3f2ab98',
    },
  },
  {
    id: 'home-subscribe',
    type: 'subscribe',
    isActive: true,
    // Presentation only. The FORM stays in code - it posts to
    // subscribe_to_email_list, and its fields are that function's contract.
    title: 'STAY IN THE LOOP',
    subtitle:
      'Join our mailing list and receive the latest news and updates from ' +
      'our team.',
    image: {
      name: 'newsletter-banner',
      url: STORAGE + 'Web-Pages%2FShared%2Fnewsletter-banner.PNG?alt=media&token=928f4a44-6a3a-420b-8bf2-9aa127c1f48a',
    },
  },
];

/**
 * Describes a section in one line, for the dry-run listing.
 * @param {object} section One entry from SECTIONS.
 * @return {string} Short human-readable summary of its content.
 */
function describe(section) {
  if (section.items) {
    return `${section.items.length} card(s)`;
  }
  if (section.title) {
    return JSON.stringify(section.title.replace(/<[^>]+>/g, '').slice(0, 44));
  }
  return '(no content of its own)';
}

async function main() {
  const args = process.argv.slice(2);
  const projectArg =
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');
  const force = args.includes('--force');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(
    `\nProject: ${projectId}` +
    `${execute ? '  (EXECUTE)' : '  (dry run)'}` +
    `${force ? '  (FORCE - overwrites existing sections)' : ''}`
  );

  const existing = await db.collection(COLLECTION).get();
  console.log(`  ${existing.size} section(s) already in ${COLLECTION}\n`);

  let written = 0;
  let skipped = 0;

  for (let i = 0; i < SECTIONS.length; i++) {
    const {id, ...content} = SECTIONS[i];
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (snap.exists && !force) {
      console.log(`  SKIP    ${id.padEnd(20)} already present`);
      skipped++;
      continue;
    }

    const verb = snap.exists ? 'REPLACE' : 'WRITE  ';
    console.log(
      `  ${verb} ${id.padEnd(20)} ` +
      `order=${i} ${content.type.padEnd(13)} ${describe(SECTIONS[i])}`
    );
    written++;

    if (execute) {
      // order comes from the array position, never from a stored number
      // somebody typed. set() rather than merge: --force means "put this
      // section back to the shipped default", and a merge would leave
      // fields an edit had added.
      await ref.set({...content, order: i});
    }
  }

  console.log(
    `\n  ${written} to write, ${skipped} left alone` +
    `${execute ? '' : '  - dry run, nothing changed'}\n`
  );
}

// Guarded so this file can be REQUIRED for its data without running the
// seed. The emulator fixture world builds `home_sections` from SECTIONS
// below rather than carrying a second copy of it - a fixture that disagreed
// with the shipped default would make the emulator prove the wrong page.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {SECTIONS};
