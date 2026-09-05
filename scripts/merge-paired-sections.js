// Folds every `pairWithNext` pair into ONE section with two columns, so the
// lever itself can be deleted.
//
//   node scripts/merge-paired-sections.js --project=dev             (dry run)
//   node scripts/merge-paired-sections.js --project=dev --execute
//   node scripts/merge-paired-sections.js --project=prod --execute
//
// Dry-run by default. Runs on prod too, and MUST run there before the web
// build that stops honouring `pairWithNext` ships - otherwise the Contact
// page's two halves become two stacked full-width bands.
//
// WHY. `pairWithNext` was a section-level lever describing a relationship
// with a NEIGHBOUR: "put the next section beside me, half and half". One
// block on the whole site ever used it - Contact's intro paired with its
// form - and it bought two problems for that one use.
//
// The first is that it was the wrong shape. A SECTION already holds one to
// three columns of any piece kind, and `form` is a piece kind, so "text on
// the left, a form on the right" was always expressible as one section with
// two columns. The lever was a second way to say something the archetype
// already said.
//
// The second is what it looked like. `.kit-pair-row` is a two-cell grid, and
// a grid cell stretches: each half is its own <app-kit-section>, each paints
// its own ground for the full height of the taller one, so the shorter half
// - the intro - drew a slab of empty ground under its last line. Columns
// inside ONE section do not do that: `.kit-cols` centres them, and there is a
// single ground behind the whole band.
//
// WHAT MOVES. The two blocks' `columns` arrays are concatenated in order and
// the pair's OWN section-level keys are taken from the first block, which is
// the one that carried the layout decision. Per-column settings (Contact's
// left `inset`, its right `align`/`measure`) live on the columns and travel
// with them untouched. A block that pairs with nothing after it - which the
// site quietly stacked anyway - just loses the dead key.
//
// A pair whose halves DISAGREE about the section-level look is refused rather
// than merged: one section cannot have two grounds, and silently keeping the
// first one would change a page without saying so.

const fs = require('fs');
const path = require('path');
const {tenantCollection} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Section-level keys that cannot survive two different answers. */
const CONFLICTING = [
  'surface', 'variant', 'headingStyle', 'copySize', 'mediaSize', 'textTone',
  'cardsPerRow', 'image', 'photoFocus', 'photoFocusPoint'
];

/**
 * Merges the pairs in one page's block list.
 * @param {Array} blocks The page's sections, in order.
 * @param {string} pageId The page, for messages.
 * @returns {{blocks: Array, notes: string[]}} The new list and what happened.
 */
function mergePairs(blocks, pageId) {
  const out = [];
  const notes = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (!block.pairWithNext) {
      out.push(block);
      i++;
      continue;
    }

    const next = blocks[i + 1];
    if (!next) {
      // It paired with nothing and the site already stacked it.
      const {pairWithNext, ...rest} = block;
      notes.push(`${pageId} [${i}] ${block.key}: paired with nothing - key dropped`);
      out.push(rest);
      i++;
      continue;
    }

    const clash = CONFLICTING.filter((k) => {
      const a = JSON.stringify(block[k] ?? null);
      const b = JSON.stringify(next[k] ?? null);
      return a !== b;
    });
    if (clash.length) {
      notes.push(
        `${pageId} [${i}] ${block.key} + ${next.key}: REFUSED, the halves ` +
        `disagree about ${clash.join(', ')} - merge this one by hand`);
      out.push(block, next);
      i += 2;
      continue;
    }

    const {pairWithNext, columns: left, ...rest} = block;
    // REKEY THE INCOMING COLUMNS. Each half numbered its own columns from
    // col-1, so a straight concatenation gives one section two columns called
    // col-1 - and both templates track columns BY KEY. Two rows sharing a key
    // behave as one: in the editor, dragging one moves the other and deleting
    // one deletes both; on the page, Angular reuses the first column's DOM for
    // the second. Piece keys are tracked within their own column, so those may
    // repeat safely and are left alone.
    const columns = [...(left || [])];
    const taken = new Set(columns.map((c) => c.key));
    for (const column of next.columns || []) {
      let key = column.key;
      if (taken.has(key)) {
        let n = 2;
        while (taken.has(`${key}-${n}`)) {
          n++;
        }
        key = `${key}-${n}`;
        notes.push(`${pageId} [${i}] column ${column.key} -> ${key} (key already taken)`);
      }
      taken.add(key);
      columns.push({...column, key});
    }
    const merged = {...rest, columns};
    // Both halves have to be live for the row to have looked whole; if either
    // was switched off the merged section follows the FIRST, which is the one
    // whose isActive the row's own presence depended on.
    notes.push(
      `${pageId} [${i}] ${block.key} + ${next.key} -> one section, ` +
      `${merged.columns.length} columns`);
    out.push(merged);
    i += 2;
  }

  return {blocks: out, notes};
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId(
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);

  console.log(`project: ${projectId}${execute ? '  (WRITING)' : '  (dry run)'}\n`);

  const db = getFirestoreFor(projectId);
  const snap = await tenantCollection(db, 'page_content').get();
  const writes = [];

  for (const doc of snap.docs) {
    const blocks = doc.data().blocks || [];
    if (!blocks.some((b) => 'pairWithNext' in b)) {
      continue;
    }
    const {blocks: next, notes} = mergePairs(blocks, doc.id);
    notes.forEach((n) => console.log('  ' + n));
    if (next.some((b) => 'pairWithNext' in b)) {
      console.log(`  ${doc.id}: still carries the key - not written`);
      continue;
    }
    writes.push({ref: doc.ref, blocks: next});
  }

  // The seed world has to produce the merged shape too, or a reseeded
  // emulator resurrects a lever the code no longer reads.
  const seedPath = path.join(__dirname, 'page-content-seed-data.json');
  let seedTouched = 0;
  let seed = null;
  if (fs.existsSync(seedPath)) {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const key of Object.keys(seed)) {
      const blocks = Array.isArray(seed[key]) ? seed[key] : seed[key].blocks;
      if (!Array.isArray(blocks) || !blocks.some((b) => 'pairWithNext' in b)) {
        continue;
      }
      const {blocks: next, notes} = mergePairs(blocks, `seed:${key}`);
      notes.forEach((n) => console.log('  ' + n));
      if (Array.isArray(seed[key])) {
        seed[key] = next;
      } else {
        seed[key].blocks = next;
      }
      seedTouched++;
    }
  }

  console.log(`\n${writes.length} page(s) and ${seedTouched} seed page(s).`);

  if (!execute) {
    console.log('Dry run. Re-run with --execute to write.');
    return;
  }

  for (const w of writes) {
    await w.ref.update({blocks: w.blocks});
  }
  if (seed && seedTouched) {
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  }
  console.log('Written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
