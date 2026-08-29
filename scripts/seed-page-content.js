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
// WHY THIS EXISTS AT ALL, and it is not what an earlier version of this
// comment said. It claimed the templates fall back to their own copy so the
// site stays correct with the collection empty. THAT FALLBACK IS GONE - the
// duplicate was removed from the templates the day they were seeded (Shane's
// call, 2026-08-29), because one copy that can be edited beats two that can
// silently disagree. These documents are now the ONLY copy of eleven pages'
// text. An environment without them shows eleven empty pages.
//
// Consequence to carry into every deploy: page_content must exist in an
// environment BEFORE the web build that reads it ships there.
//
// EVERY PAGE IS A SECTION STACK. Each block carries a `type` naming which
// section draws it, and the ARRAY'S ORDER is the page's order - so this file
// is what a visitor meets on the way down the page, top to bottom. Nothing
// stores a position: no order number, no left/right flag on an entry. The one
// exception is `column` on a two-column passage, which earns it - see
// page-content.model.ts.
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
  if (block.subheading !== undefined) bits.push('2nd heading');
  if (block.body !== undefined) {
    bits.push('copy ' + block.body.replace(/<[^>]+>/g, '').trim().length + 'ch');
  }
  if (block.image !== undefined) bits.push('picture');
  if (block.videoId !== undefined) bits.push('video');
  if (block.ctaTitle !== undefined) bits.push('button');
  if (block.ctaTitle2 !== undefined) bits.push('2nd button');
  // Listed explicitly because leaving it out once already hid a real
  // problem: the equipping-groups course cards were seeded as nothing and
  // the dry run reported the slot as a bare heading, so it read as correct.
  // The column split is spelled out for the same reason - a two-column block
  // whose entries all landed in one column would otherwise read as fine.
  if (block.items !== undefined) {
    const left = block.items.filter((i) => i.column === 'left').length;
    const right = block.items.filter((i) => i.column === 'right').length;
    bits.push(
      block.items.length + ' entr' + (block.items.length === 1 ? 'y' : 'ies') +
      (left || right ? ` (${left} left, ${right} right)` : '')
    );
  }
  return bits.join(' + ') || '(nothing to edit)';
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
      `${blocks.length} section(s)`
    );
    for (const block of blocks) {
      console.log(
        `            - ${block.key.padEnd(14)} ` +
        `${(block.type || '(no type)').padEnd(14)} ${describe(block)}`
      );
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
