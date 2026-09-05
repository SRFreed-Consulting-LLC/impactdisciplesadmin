// Renames any column whose key another column in the SAME section already
// uses.
//
//   node scripts/fix-duplicate-column-keys.js --project=dev            (dry run)
//   node scripts/fix-duplicate-column-keys.js --project=dev --execute
//   node scripts/fix-duplicate-column-keys.js --project=prod --execute
//
// Dry-run by default.
//
// WHY. Both templates that draw a section's columns track them BY KEY -
// `@for (column of columns; track column.key)` in the admin's section editor
// and `@for (column of liveColumns; track column.key)` in the web app's
// kit-section. Two columns sharing a key are one row as far as Angular is
// concerned: in the editor, dragging one moves the other and deleting one
// deletes both; on the page, the first column's DOM is reused for the second.
//
// It could not happen while every section numbered its own columns from
// col-1. merge-paired-sections.js made it possible on 2026-09-05 by
// concatenating two sections' column arrays, and did it once - to the Contact
// page, on dev and prod, before the rekeying went into that script. This
// repairs what that run wrote and is safe to run again on anything.
//
// PIECE keys are deliberately not touched: pieces are tracked within their
// own column (`piecesOf(column)` / `livePieces(column)`), so the same piece
// key in two different columns collides with nothing.

const {tenantCollection} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/**
 * Gives every column in one section a key no earlier column uses.
 * @param {Array} columns The section's columns, in order.
 * @param {Function} note Called with a description of each rename.
 * @returns {boolean} Whether anything was renamed.
 */
function rekey(columns, note) {
  const taken = new Set();
  let changed = false;
  for (const column of columns) {
    if (!taken.has(column.key)) {
      taken.add(column.key);
      continue;
    }
    let n = 2;
    while (taken.has(`${column.key}-${n}`)) {
      n++;
    }
    const was = column.key;
    column.key = `${column.key}-${n}`;
    taken.add(column.key);
    changed = true;
    note(`${was} -> ${column.key}`);
  }
  return changed;
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
    let touched = false;
    blocks.forEach((block, i) => {
      if (!Array.isArray(block.columns) || block.columns.length < 2) {
        return;
      }
      if (rekey(block.columns, (what) => {
        console.log(`  ${doc.id} [${i}] ${block.key}: ${what}`);
      })) {
        touched = true;
      }
    });
    if (touched) {
      writes.push({ref: doc.ref, blocks});
    }
  }

  console.log(`\n${writes.length} page(s) to repair.`);

  if (!execute) {
    console.log('Dry run. Re-run with --execute to write.');
    return;
  }

  for (const w of writes) {
    await w.ref.update({blocks: w.blocks});
  }
  console.log('Written.');
}

// Guarded so requiring this file for its test does not run the repair.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {rekey};
