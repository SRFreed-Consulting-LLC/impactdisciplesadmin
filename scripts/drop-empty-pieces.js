#!/usr/bin/env node
/**
 * Remove pieces the migration created with nothing in them.
 *
 *   node scripts/drop-empty-pieces.js --project=dev
 *   node scripts/drop-empty-pieces.js --project=dev --execute
 *
 * A BUG IN THE FLIP, found by Shane looking at Equipping - Leaders and
 * asking why a two-column band showed three columns.
 *
 * toSectionModel decided whether a piece was worth making by asking whether
 * ANY of the fields it had been handed held something. A heading built from
 * an empty heading still carried `level: 'section'`, so it counted as
 * meaningful and an empty heading piece was made. On the two-column bands
 * that piece went into a FULL-WIDTH column of its own, which drew a
 * horizontal rule with nothing above it on the page and showed as a phantom
 * third column in the editor. Same for a picture with no image but a
 * photoFocus.
 *
 * The flip now judges a piece on its CONTENT fields alone - see
 * PIECE_CONTENT_FIELDS - and the renderer draws nothing for a piece with no
 * words either way. This clears what the old rule already wrote.
 *
 * WHAT IT REMOVES:
 *   - heading / eyebrow / note pieces with no text
 *   - text pieces whose html has no words in it ("<p></p>" counts as empty)
 *   - picture pieces with no image, video pieces with no video
 *   - any COLUMN left holding nothing at all afterwards
 *
 * WHAT IT KEEPS: a piece that draws without content of its own - siteDetails
 * reads Web Config, signup and countdown draw their own furniture - and any
 * column somebody deliberately left empty but which was not emptied by this.
 *
 * DEV ONLY, dry-run by default, re-run is a no-op.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Kinds that MUST carry their own content to be worth drawing. */
const NEEDS = {
  heading: (p) => hasWords(p.text),
  eyebrow: (p) => hasWords(p.text),
  note: (p) => hasWords(p.text),
  text: (p) => hasWords(p.html),
  picture: (p) => !!p.image,
  video: (p) => !!p.videoId,
  buttons: (p) => (p.buttons ?? []).length > 0,
  form: (p) => !!p.formId,
  price: (p) => !!p.amountKey
};

function hasWords(value) {
  return !!value && String(value).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
}

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

(async () => {
  const db = getFirestoreFor(projectId);
  const snap = await db.collection('page_content').get();

  let droppedPieces = 0;
  let droppedColumns = 0;
  let pages = 0;

  for (const doc of snap.docs) {
    const blocks = doc.data().blocks ?? [];
    const said = [];

    for (const block of blocks) {
      if (!block.columns) {
        continue;
      }
      for (const column of block.columns) {
        const before = column.pieces ?? [];
        const kept = before.filter((p) => {
          const test = NEEDS[p.kind];
          return !test || test(p);
        });
        if (kept.length !== before.length) {
          before.filter((p) => !kept.includes(p))
            .forEach((p) => said.push('  ' + block.key + ' / ' + column.key
              + ': empty ' + p.kind + ' removed'));
          droppedPieces += before.length - kept.length;
          column.pieces = kept;
        }
      }

      const emptied = block.columns.filter((c) => (c.pieces ?? []).length === 0);
      if (emptied.length && emptied.length < block.columns.length) {
        emptied.forEach((c) => said.push('  ' + block.key + ' / ' + c.key
          + ': column now holds nothing - removed'
          + (c.full ? ' (this was the phantom full-width one)' : '')));
        droppedColumns += emptied.length;
        block.columns = block.columns.filter((c) => (c.pieces ?? []).length > 0);
      }
    }

    if (!said.length) {
      continue;
    }
    pages++;
    console.log('\n### ' + doc.id);
    said.forEach((line) => console.log(line));

    if (execute) {
      await doc.ref.update({blocks});
      console.log('  WRITTEN.');
    }
  }

  console.log('\n' + droppedPieces + ' empty piece(s) and ' + droppedColumns
    + ' emptied column(s) across ' + pages + ' page(s).');
  if (!droppedPieces && !droppedColumns) {
    console.log('Nothing to do.');
  } else if (!execute) {
    console.log('DRY RUN. Re-run with --execute to write.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
