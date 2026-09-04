// Repairs stored rich text that arrived by paste with its words joined.
//
//   node scripts/clean-pasted-rich-text.js --project=dev|prod [--collection=page_content] [--execute]
//
// WHAT IS BEING REPAIRED (2026-09-04, Coaching With Impact). Two sections on
// that page rendered with their copy visibly off-centre while every other
// centred section on it sat correctly. Nothing was configured wrong - both
// columns carried align:'centre' and measure:true, the same pair as the
// section below them that looked right. The damage was inside the words:
// their HTML held 108 and 154 `&nbsp;` and NOT ONE ordinary space, which
// makes a paragraph a single unbreakable "word" 718 and 1003 characters long.
// Text that cannot break cannot wrap, so it overflowed the column's measured
// width instead of laying out inside it and stopped sharing the page's
// centre. The same paste also carried `color: rgb(34, 34, 34)` and
// `background-color: rgb(255, 255, 255)`, which override the section's own
// surface - invisible on a white band, a white highlight on any other.
//
// The editor no longer accepts either (src/app/shared/rich-text-editor/
// quill-paste-cleanup.ts). This is the half that fix cannot do: content
// already written.
//
// WHAT IT TOUCHES. Every string anywhere in the document, at any depth - a
// page's blocks, their columns, their pieces, a list's items. Generic rather
// than field-by-field on purpose: the same paste can land in any of them, and
// a walker that knows the shape would need editing every time the shape
// changes. Only strings that actually carry the damage are rewritten, so a
// document with none is not written at all.
//
// WHAT IT DELIBERATELY LEAVES. A `<span>` left with no attributes once its
// colours are gone. Unwrapping balanced tags needs a parser, not a regex, and
// a bare span renders identically to no span at all - the cost of removing it
// is a whole class of bug and the benefit is a shorter string.
//
// EVERY NBSP GOES, including one somebody meant. Same trade as the editor
// matcher: an nbsp that becomes a space costs a line break nobody will
// notice, while one that survives can take a page's layout with it.
//
// Idempotent: a second run finds nothing. Dry by default - pass --execute.

const {resolveProjectId, getFirestoreFor} = require('./lib/firestore-admin');
const {tenantPath} = require('./lib/tenancy');

const NBSP = String.fromCharCode(0xa0);

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

/**
 * Non-breaking spaces, as a character or as an entity, turned back into
 * ordinary ones.
 * @param {string} html The stored string.
 * @return {string} The same string with nothing in it that cannot break.
 */
function unjoinWords(html) {
  return html.split(NBSP).join(' ').split('&nbsp;').join(' ');
}

/**
 * Colour and background declarations removed from every inline style, and any
 * style attribute left empty removed with them.
 *
 * The CSS property names here, not Quill's format names - this is HTML on the
 * way out of Firestore, not a Delta.
 * @param {string} html The stored string.
 * @return {string} The same string wearing none of the source page's colours.
 */
function stripInkStyles(html) {
  return html.replace(/ style="([^"]*)"/g, (whole, declarations) => {
    const kept = declarations
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => !/^(color|background|background-color)\s*:/i.test(d));
    return kept.length ? ` style="${kept.join('; ')};"` : '';
  });
}

/**
 * Both repairs, in the order that keeps them independent - or one of them.
 *
 * THEY ARE SEPARABLE ON PURPOSE, and the reason showed up on the first dry
 * run. Unjoining words is safe everywhere: it changes where a line may break
 * and nothing else, so no page can look different for the worse. Stripping
 * colour is a VISIBLE change, and correct only where the colour was picked up
 * by accident. The same run that found the Coaching page also found Privacy
 * Policy and Terms wearing `color: rgb(102, 102, 102)` - pasted too, but
 * they have rendered that way for as long as they have existed and nobody
 * asked for them to change. A script that quietly restyled two legal pages
 * while fixing a third page's layout would be a worse bug than the one it
 * fixed.
 * @param {string} value The stored string.
 * @param {string} only 'nbsp', 'ink', or 'both'.
 * @return {string} The repaired string.
 */
function clean(value, only) {
  let out = value;
  if (only !== 'ink') out = unjoinWords(out);
  if (only !== 'nbsp') out = stripInkStyles(out);
  return out;
}

/** Whether a string carries the damage this run is repairing. */
const isDamaged = (value, only) => clean(value, only) !== value;

/**
 * A deep copy with every damaged string repaired, and a note of each one.
 *
 * Anything that is not a plain object, an array or a string passes through BY
 * REFERENCE - a Timestamp, a GeoPoint or a DocumentReference must reach the
 * write as itself rather than as a copy of its fields.
 * @param {*} value Any value from the document.
 * @param {string} path Where it sits, for the report.
 * @param {Array} found Accumulates {path, before, after}.
 * @param {string} only Which repair this run is making.
 * @return {*} The repaired value.
 */
function repair(value, path, found, only) {
  if (typeof value === 'string') {
    if (!isDamaged(value, only)) return value;
    const after = clean(value, only);
    found.push({path, before: value, after});
    return after;
  }
  if (Array.isArray(value)) {
    return value.map((entry, i) => repair(entry, `${path}[${i}]`, found, only));
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = repair(value[key], path ? `${path}.${key}` : key, found, only);
    }
    return out;
  }
  return value;
}

/** A string shortened for a one-line report, with the invisible made visible. */
const excerpt = (value) =>
  value.split(NBSP).join('<NBSP>').replace(/\s+/g, ' ').slice(0, 110);

(async () => {
  const project = arg('project');
  if (!project) {
    console.error(
      'Usage: node scripts/clean-pasted-rich-text.js --project=dev|prod\n' +
      '         [--collection=page_content] [--doc=id,id] [--only=nbsp|ink]\n' +
      '         [--execute]'
    );
    process.exit(1);
  }
  const execute = !!arg('execute');
  const collection = arg('collection') || 'page_content';
  const only = arg('only') || 'both';
  if (!['both', 'nbsp', 'ink'].includes(only)) {
    throw new Error(`--only must be nbsp, ink or both - got "${only}".`);
  }
  // Scoping to named documents, because "which pages" is a judgement the
  // person running this makes, not one this file can.
  const docFilter = typeof arg('doc') === 'string' ?
    String(arg('doc')).split(',').map((id) => id.trim()).filter(Boolean) :
    null;
  const db = getFirestoreFor(resolveProjectId(project));

  const path = tenantPath(collection);
  const snap = await db.collection(path).get();
  // The lesson from every script that read the wrong path: "0 documents,
  // nothing to do" and exit zero looks exactly like success.
  if (snap.empty) {
    throw new Error(
      `No documents at "${path}" - refusing to report a clean run against a ` +
      'path that holds nothing.'
    );
  }
  if (docFilter) {
    const missing = docFilter.filter((id) => !snap.docs.some((d) => d.id === id));
    if (missing.length) {
      throw new Error(
        `--doc named ${missing.join(', ')}, which ${path} does not hold. ` +
        'Refusing to run a filter that silently matches nothing.'
      );
    }
  }
  console.log(
    `project ${project} | reading ${path} | ${snap.size} documents | ` +
    `repairing ${only} | ${docFilter ? `only ${docFilter.join(', ')} | ` : ''}` +
    `${execute ? 'EXECUTE' : 'dry run'}\n`
  );

  let dirtyDocs = 0;
  let dirtyFields = 0;

  for (const doc of snap.docs) {
    if (docFilter && !docFilter.includes(doc.id)) continue;
    const found = [];
    const repaired = repair(doc.data(), '', found, only);
    if (!found.length) continue;

    dirtyDocs++;
    dirtyFields += found.length;
    console.log(`${doc.id} - ${found.length} field(s)`);
    for (const hit of found) {
      const nbsp = (hit.before.split(NBSP).length - 1) +
        (hit.before.split('&nbsp;').length - 1);
      const styles = (hit.before.match(/(background-)?color\s*:/gi) || []).length;
      console.log(
        `  ${hit.path}  [${nbsp} nbsp, ${styles} colour declaration(s)]`
      );
      console.log(`    before: ${excerpt(hit.before)}`);
      console.log(`    after:  ${excerpt(hit.after)}`);
    }

    if (execute) {
      await doc.ref.set(repaired);
      console.log('  written');
    }
    console.log('');
  }

  if (!dirtyDocs) {
    console.log('Nothing to repair.');
  } else {
    console.log(
      `${dirtyFields} field(s) across ${dirtyDocs} document(s) ` +
      `${execute ? 'repaired' : 'would be repaired - re-run with --execute'}.`
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
