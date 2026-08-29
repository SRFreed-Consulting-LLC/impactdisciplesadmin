#!/usr/bin/env node
// Carries the Coaching with Impact page's saved content out of its own
// `coaching_page` singleton and into `page_content/coaching-with-impact`,
// where the other twelve public pages live (2026-08-29).
//
//   node scripts/migrate-coaching-to-page-content.js --project=dev
//   node scripts/migrate-coaching-to-page-content.js --project=dev --execute
//
// Dry-run by default, like every script in this folder.
//
// WHY IT EXISTS. That page became an ordered section stack like the rest, so
// the three things staff had already set through the bespoke screen - the
// progress-report VIDEO, the ORDER of the quote carousel, and the online
// group's SCREENSHOTS - have to land on the matching sections rather than be
// quietly reset to whatever the seed ships.
//
// RUN IT AFTER THE SEED, not before: it edits sections the seed creates. Run
// it before, and there is nothing to write onto.
//
// IDEMPOTENT. It reads the old document and overwrites those three fields
// every time, so running it twice is the same as running it once. It does not
// delete `coaching_page` - leaving the old record costs nothing and means a
// mistake here is recoverable by running it again.
//
// SAFE WHERE THERE IS NOTHING TO CARRY. An environment whose staff never
// saved that screen has no `coaching_page` document at all, which is not an
// error: it reports "nothing to carry" and leaves the seeded defaults, which
// are the same content the page shipped with.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const OLD_COLLECTION = 'coaching_page';
const OLD_DOC = 'current';
const NEW_COLLECTION = 'page_content';
const NEW_DOC = 'coaching-with-impact';

/** Which section each piece of the old record belongs on. */
const VIDEO_KEY = 'report';
const QUOTES_KEY = 'quotes';
const GALLERY_KEY = 'online';

async function main() {
  const args = process.argv.slice(2);
  const projectArg =
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(
    `\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}\n`
  );

  const oldSnap = await db.collection(OLD_COLLECTION).doc(OLD_DOC).get();
  if (!oldSnap.exists) {
    console.log(
      `  No ${OLD_COLLECTION}/${OLD_DOC} in this project - nothing to carry.\n` +
      '  The seeded sections already hold what the page shipped with.\n'
    );
    return;
  }
  const old = oldSnap.data();

  const newRef = db.collection(NEW_COLLECTION).doc(NEW_DOC);
  const newSnap = await newRef.get();
  if (!newSnap.exists) {
    console.log(
      `  ${NEW_COLLECTION}/${NEW_DOC} does not exist yet.\n` +
      '  Run scripts/seed-page-content.js first - this edits the sections it\n' +
      '  creates, and has nothing to write onto until then.\n'
    );
    process.exitCode = 1;
    return;
  }

  const blocks = (newSnap.data().blocks || []).map((block) => ({...block}));
  const find = (key) => blocks.find((b) => b.key === key);
  const changes = [];

  // ---------------------------------------------------------------- video
  const report = find(VIDEO_KEY);
  if (report && old.videoId) {
    changes.push(`video      ${report.videoId || '(none)'} -> ${old.videoId}`);
    report.videoId = old.videoId;
    if (old.videoUrl) {
      report.videoUrl = old.videoUrl;
    }
  }

  // ------------------------------------------------------- quote order
  const quotes = find(QUOTES_KEY);
  const ids = old.testimonialIds || [];
  if (quotes && ids.length) {
    changes.push(
      `quotes     ${(quotes.testimonialIds || []).length} -> ${ids.length} in order`
    );
    quotes.testimonialIds = ids;
  }

  // -------------------------------------------------------- screenshots
  // `order` is dropped on the way across, deliberately: a section's entries
  // are ordered by their position in the array everywhere else in this model,
  // and carrying a second source of truth for it is exactly what the rest of
  // this work removed. Sorted by the old number on the way in so the running
  // order survives.
  const gallery = find(GALLERY_KEY);
  const shots = (old.screenshots || [])
    .filter((s) => s.image && s.image.url)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (gallery && shots.length) {
    changes.push(
      `pictures   ${(gallery.items || []).length} -> ${shots.length}`
    );
    gallery.items = shots.map((s) => ({
      title: 'Coaching With Impact online discipleship group',
      image: s.image,
      // A switched-off screenshot stays switched off.
      isActive: s.isActive !== false,
    }));
  }

  if (!changes.length) {
    console.log('  The old record holds nothing the sections do not - nothing to do.\n');
    return;
  }

  changes.forEach((line) => console.log(`  ${line}`));

  if (execute) {
    await newRef.set({blocks});
    console.log(`\n  Written to ${NEW_COLLECTION}/${NEW_DOC}.\n`);
  } else {
    console.log('\n  Dry run - nothing changed.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
