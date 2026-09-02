const {tenantCollection} = require("./lib/tenancy");
/**
 * Show a form's field LABELS instead of hiding them in the placeholder.
 *
 *   node scripts/form-labels-above-fields.js --project=dev
 *   node scripts/form-labels-above-fields.js --project=dev --execute
 *
 * WHY. A placeholder disappears the moment somebody types. On a four-field
 * form that means you cannot check what you put in the second box without
 * clearing it, and a screen reader gets no name for the field at all - the
 * input has no label, no aria-label and no title. Shane saw the effect of it
 * on the Seminars page (2026-08-31) as "black fields with no headings" and
 * asked for the labels switched on.
 *
 * WHAT IT TOUCHES. Only fields whose labelDisplay is the string 'placeholder',
 * and only in `forms`. Of the five forms on dev, exactly one - Consultation
 * Request - is set that way; every other form already shows its labels, which
 * is also why the two look nothing alike today.
 *
 * The field keeps its `placeholder` text. A visible label AND a placeholder is
 * the normal arrangement; the renderer only suppresses the label when
 * labelDisplay says 'placeholder', so clearing that setting is the whole
 * change. Nothing else about the form moves.
 *
 * DEV ONLY, and it refuses prod outright. Dry-run by default; --execute
 * writes. Re-running after a successful run finds nothing to do and says so,
 * so it is safe to run twice.
 */
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

if (!projectArg) {
  console.error('Missing --project=dev. There is no default.');
  process.exit(1);
}

const projectId = resolveProjectId(projectArg);

// The guard is the point, not a formality: this rewrites live form documents,
// and production's forms have not been reviewed for this change.
if (projectArg === 'prod' || /a82a8/.test(projectId)) {
  console.error(
    'REFUSED: this script is for dev only. Production forms are a separate\n' +
    'decision - run it there deliberately, after somebody has looked.'
  );
  process.exit(1);
}

/** Every field in a form, including the ones nested inside a columns row. */
function walk(fields, visit) {
  for (const field of fields ?? []) {
    visit(field);
    if (Array.isArray(field.columns)) {
      for (const column of field.columns) {
        walk(Array.isArray(column) ? column : column.fields, visit);
      }
    }
    if (Array.isArray(field.fields)) {
      walk(field.fields, visit);
    }
  }
}

(async () => {
  const db = getFirestoreFor(projectId);
  const snap = await tenantCollection(db, "forms").get();

  let changedForms = 0;
  let changedFields = 0;

  for (const doc of snap.docs) {
    const form = doc.data();
    const hits = [];

    walk(form.fields, (field) => {
      if (field.labelDisplay === 'placeholder') {
        hits.push(field.label || '(unnamed)');
        // DELETED rather than set to another value: absent is what every
        // other form on the site carries, and the renderer's own default.
        // Writing a second spelling of "show the label" would leave two.
        delete field.labelDisplay;
      }
    });

    if (!hits.length) {
      continue;
    }

    changedForms++;
    changedFields += hits.length;
    console.log(`\n${form.name || doc.id}`);
    for (const label of hits) {
      console.log(`  label shown: ${label}`);
    }

    if (execute) {
      await doc.ref.update({fields: form.fields});
    }
  }

  console.log(
    `\n${changedFields} field(s) across ${changedForms} form(s) on ${projectId}.`
  );
  if (!changedFields) {
    console.log('Nothing to do - every form already shows its labels.');
  } else if (!execute) {
    console.log('DRY RUN. Re-run with --execute to write.');
  } else {
    console.log('Written.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
