// One-time (idempotent) backfill for the 2026-08 Courses retirement: copy
// each course-backed agenda item's display data from its courses/{id} doc
// onto the item itself, so breakouts are self-contained:
//   text        <- course.title (leading "Breakout: " prefix stripped - the
//                  public site always stripped it at display time)
//   description <- course.longDescription || course.shortDescription
// Only where the item's own field is empty, so re-runs and admin-edited
// items are untouched. `coaches` already lives on the item (no course doc
// ever carried coachIds in real data) and `course` is left in place as
// frozen provenance (see agenda-item.model.ts).
//
// Registrations are NOT touched - trainingSessions[] already stores agenda-
// item ids, and item ids are never changed here.
//
// Rewrites each affected event's whole agendaItems array (embedded array -
// one update per event). Take a fresh `node scripts/export.js` backup of
// `events` before a prod run.
//
//   node scripts/flatten-courses-onto-agenda-items.js --project=dev [--dry-run]

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/flatten-courses-onto-agenda-items.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));

  const [courseSnap, eventSnap] = await Promise.all([
    db.collection('courses').get(),
    db.collection('events').get(),
  ]);
  const courses = new Map(courseSnap.docs.map((d) => [d.id, d.data()]));
  console.log(`${courses.size} courses, ${eventSnap.size} events`);

  let eventsChanged = 0;
  let itemsFlattened = 0;
  const dangling = [];

  for (const doc of eventSnap.docs) {
    const data = doc.data();
    const items = data.agendaItems;
    if (!Array.isArray(items) || !items.length) continue;

    let changed = false;
    const next = items.map((item) => {
      if (!item || !item.isCourse || !item.course) return item;
      const course = courses.get(item.course);
      if (!course) {
        dangling.push(`event ${doc.id} "${data.eventName}" item ${item.id}: course ${item.course} does not exist`);
        return item;
      }
      const updated = { ...item };
      let touched = false;
      if (!updated.text) {
        updated.text = (course.title ?? '').replace(/^Breakout:\s*/, '');
        touched = true;
      }
      if (!updated.description) {
        const description = course.longDescription || course.shortDescription || '';
        if (description) {
          updated.description = description;
          touched = true;
        }
      }
      if (touched) {
        changed = true;
        itemsFlattened++;
        console.log(`  ${doc.id} "${data.eventName}" item ${item.id}: text="${updated.text}"`);
      }
      return touched ? updated : item;
    });

    if (changed) {
      eventsChanged++;
      if (!dryRun) await doc.ref.update({ agendaItems: next });
    }
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}${itemsFlattened} agenda item(s) flattened across ${eventsChanged} event(s)`);
  if (dangling.length) {
    console.log('\nDANGLING course refs (left untouched - these items will show "(unknown breakout)"):');
    dangling.forEach((d) => console.log('  - ' + d));
  }
})().catch((e) => { console.error(e); process.exit(1); });
