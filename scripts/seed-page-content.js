#!/usr/bin/env node
// Seeds `page_content` with the copy each public page already shows, so the
// Page Manager editors open with real text instead of empty boxes
// (2026-08-29).
//
//   node scripts/seed-page-content.js --project=dev
//   node scripts/seed-page-content.js --project=dev --execute
//   node scripts/seed-page-content.js --project=dev --page=about-us
//
// Dry-run by default, like every script in this folder.
//
// WHY THIS EXISTS AT ALL. The web templates fall back to their own copy
// when a block is missing, so the site was already correct with the
// collection empty - and it stays correct if these documents are ever
// deleted. What an empty collection is NOT is usable: to change three words
// of a paragraph staff would have had to open the live site, copy the text
// and paste it in. Seeding is what makes the editors editable.
//
// IDEMPOTENT, AND IT WILL NOT OVERWRITE STAFF EDITS. Document ids are the
// page slugs, and a page that already exists is SKIPPED rather than
// rewritten. --force is the deliberate reset back to the shipped wording.
//
// The data in page-content-seed-data.json was EXTRACTED FROM THE WEB
// TEMPLATES, never retyped, so it is byte-identical to what the site
// renders. Two cleanings were applied and both are deliberate:
//
//   * appAnimate attributes are stripped. Content rendered through
//     [innerHTML] is never compiled by Angular, so the directive could not
//     run - it would be dead noise inside staff's copy. The animation is
//     unaffected: the wrapper element carries its own appAnimate.
//   * A class on a body's outermost element is stripped where the
//     template's wrapper already applies that same class (the Discipleship
//     Library's two lede blocks), which would otherwise double it. Every
//     other class is kept - mt-10 / mb-5 on the Pastors page are real
//     spacing inside a multi-part body.
//
// HEADINGS KEEP THEIR MARKUP. `OUR STORY BEGAN WITH A <strong>NEED</strong>`
// is stored exactly like that and rendered with [innerHTML], so the bold
// survives. Staff see the tags in the heading box, which is the trade
// Shane chose (2026-08-29) over the alternatives: stripping the tags loses
// the emphasis on the next save, and a rich-text heading would round-trip
// through Quill 2's getSemanticHTML(), which encodes every space as
// &nbsp; - non-breaking spaces do not wrap, so a heading would overflow on
// a phone. See merge-tags.functions.ts for the same trap from another
// direction.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');
const SEED = require('./page-content-seed-data.json');

const COLLECTION = 'page_content';

/** One-line summary of a block, for the dry-run listing. */
function describe(block) {
  const bits = [];
  if (block.heading !== undefined) bits.push('heading');
  if (block.body !== undefined) {
    bits.push('copy ' + block.body.replace(/<[^>]+>/g, '').trim().length + 'ch');
  }
  if (block.image !== undefined) bits.push('picture');
  if (block.ctaTitle !== undefined) bits.push('button');
  // Listed explicitly because leaving it out once already hid a real
  // problem: the equipping-groups course cards were seeded as nothing and
  // the dry run reported the slot as a bare heading, so it read as correct.
  if (block.items !== undefined) bits.push(block.items.length + ' card(s)');
  return bits.join(' + ') || '(empty)';
}

async function main() {
  const args = process.argv.slice(2);
  const projectArg =
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const only = (args.find((a) => a.startsWith('--page=')) || '').split('=')[1];
  const execute = args.includes('--execute');
  const force = args.includes('--force');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(
    `\nProject: ${projectId}` +
    `${execute ? '  (EXECUTE)' : '  (dry run)'}` +
    `${force ? '  (FORCE - overwrites existing pages)' : ''}` +
    `${only ? `  (only ${only})` : ''}`
  );

  const slugs = Object.keys(SEED).filter((slug) => !only || slug === only);
  if (!slugs.length) {
    console.log(`\n  No page matches --page=${only}\n`);
    return;
  }

  const existing = await db.collection(COLLECTION).get();
  console.log(`  ${existing.size} page(s) already in ${COLLECTION}\n`);

  let written = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const blocks = SEED[slug];
    const ref = db.collection(COLLECTION).doc(slug);
    const snap = await ref.get();

    if (snap.exists && !force) {
      console.log(`  SKIP    ${slug.padEnd(26)} already present`);
      skipped++;
      continue;
    }

    console.log(
      `  ${snap.exists ? 'REPLACE' : 'WRITE  '} ${slug.padEnd(26)}` +
      `${blocks.length} slot(s)`
    );
    for (const block of blocks) {
      console.log(`            - ${block.key.padEnd(18)} ${describe(block)}`);
    }
    written++;

    if (execute) {
      // set(), not merge: --force means "put this page back to the shipped
      // wording", and a merge would leave fields an edit had added.
      await ref.set({blocks});
    }
  }

  console.log(
    `\n  ${written} to write, ${skipped} left alone` +
    `${execute ? '' : '  - dry run, nothing changed'}\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
