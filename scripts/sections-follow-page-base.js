#!/usr/bin/env node
/**
 * Let a section FOLLOW ITS PAGE where it already looks the same.
 *
 *   node scripts/sections-follow-page-base.js --project=dev
 *   node scripts/sections-follow-page-base.js --project=dev --execute
 *
 * WHY. The page header carries a "Base" control - the page's own ground,
 * which any section set to "Same as the page" takes. It works, and on
 * 2026-08-31 it governed NOTHING: all 79 sections carried an explicit
 * ground, so zero followed the page and changing Base changed nothing you
 * could see. A working switch wired to nothing.
 *
 * That is an artefact of how the pages got here rather than a decision. The
 * first migration wrote each section the exact ground its old bespoke
 * component drew, one at a time, so nothing was left to inherit.
 *
 * WHAT IT DOES. Where a section's stored ground is ALREADY what its page's
 * Base would give it, the stored ground is removed and the section follows
 * the page instead. Nothing changes on screen - that is the point, and it is
 * how you can run this without re-reviewing fourteen pages. Afterwards,
 * changing a page's Base actually moves those sections.
 *
 * WHAT IT LEAVES ALONE. Every section whose ground DIFFERS from its page:
 * About Us's dark history band, the photo heroes, the tinted closing blocks.
 * Those are deliberate breaks in the run and they keep saying so.
 *
 * REVERSIBLE, and cheaply: the removed value is recomputable from the page's
 * Base, which is exactly why removing it is safe. Nothing else reads it.
 *
 * DEV ONLY, dry-run by default, and a re-run finds nothing left to do.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const DEFAULT_BASE = 'light';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

if (!projectArg) {
  console.error('Missing --project=dev. There is no default.');
  process.exit(1);
}
const projectId = resolveProjectId(projectArg);

if (/a82a8/.test(projectId) || projectArg === 'prod') {
  console.error('REFUSED: dev only. Production is a separate, deliberate run.');
  process.exit(1);
}

(async () => {
  const db = getFirestoreFor(projectId);
  const snap = await db.collection('page_content').get();

  let freed = 0;
  let kept = 0;
  let changedPages = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const base = data.theme?.surface || DEFAULT_BASE;
    const blocks = data.blocks ?? [];
    const following = [];
    const keeping = [];

    for (const block of blocks) {
      const own = block.surface;
      if (!own || own === 'inherit') {
        continue;
      }
      if (own === base) {
        // Removed, not set to 'inherit': absent IS "same as the page", and
        // a second spelling of it is a second thing to keep in step.
        delete block.surface;
        following.push(block.key);
      } else {
        keeping.push(block.key + ' (' + own + ')');
      }
    }

    if (!following.length) {
      kept += keeping.length;
      continue;
    }

    changedPages++;
    freed += following.length;
    kept += keeping.length;

    console.log('\n' + doc.id + '  base=' + base);
    console.log('  now follow the page: ' + following.join(', '));
    if (keeping.length) {
      console.log('  keep their own     : ' + keeping.join(', '));
    }

    if (execute) {
      await doc.ref.update({blocks});
    }
  }

  console.log('\n' + freed + ' section(s) across ' + changedPages
    + ' page(s) would follow their page; ' + kept + ' keep a ground of their own.');
  if (!freed) {
    console.log('Nothing to do.');
  } else if (!execute) {
    console.log('DRY RUN. Re-run with --execute to write.');
  } else {
    console.log('Written. Changing a page\'s Base now moves those sections.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
