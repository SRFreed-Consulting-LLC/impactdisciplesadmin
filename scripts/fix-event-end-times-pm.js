#!/usr/bin/env node
// One-time (idempotent) repair: 13 events whose endDate lost its PM.
//
// WHAT HAPPENED. A time written on a 24-hour clock stores 3pm as 15:00.
// These events stored 03:00 instead - the PM was dropped somewhere between
// the form and the save - so the record says a 9am seminar ended at 3 in the
// MORNING, six hours before it began.
//
// WHY +12h IS THE RIGHT READ, and not a guess dressed up as one: every
// affected event is a 9am (one 10am) start ending at "3:00 AM" or "3:30 AM",
// and adding 12 hours makes all 13 sensible 9-to-3 seminar days with none
// left inconsistent. Random corruption does not land that evenly; 12 hours
// is exactly the AM/PM gap. Confirmed with the owner 2026-08-27 that these
// were 9-to-3 days.
//
// SAFETY. A document is only touched when ALL of these hold:
//   - startDate and endDate are both real Timestamps
//   - endDate is currently BEFORE startDate (the symptom)
//   - the end time's local hour is < 12 (it really is an AM time)
//   - adding 12h puts endDate AFTER startDate (the repair actually works)
//   - the shifted time lands on the same calendar day, local (no DST slip)
// Anything failing a check is reported and skipped, never guessed at.
//
// Idempotent: once endDate is after startDate the document no longer
// matches, so a second run finds nothing.
//
//   node scripts/fix-event-end-times-pm.js --project=prod [--execute]

const { resolveProjectId, getFirestoreFor, firestore } = require("./lib/firestore-admin");

const TZ = "America/New_York";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value === undefined ? true : value;
};

const local = (date, opts) => date.toLocaleString("en-US", { timeZone: TZ, ...opts });
const localHour = (date) => Number(local(date, { hour: "numeric", hour12: false }));
const localDay = (date) => local(date, { dateStyle: "short" });
const stamp = (date) => local(date, { dateStyle: "medium", timeStyle: "short" });

(async () => {
  const project = arg("project");
  if (!project) {
    console.error("Usage: node scripts/fix-event-end-times-pm.js --project=dev|prod [--execute]");
    process.exit(1);
  }
  const execute = !!arg("execute");
  const db = getFirestoreFor(resolveProjectId(project));
  const { Timestamp } = firestore;

  const snap = await db.collection("events").get();
  const plan = [];
  const skipped = [];

  snap.forEach((doc) => {
    const start = doc.get("startDate");
    const end = doc.get("endDate");
    const name = String(doc.get("eventName") || "(unnamed)").slice(0, 44);

    if (!(start instanceof Timestamp) || !(end instanceof Timestamp)) return;
    if (end.toMillis() >= start.toMillis()) return; // healthy - leave alone

    const endDate = end.toDate();
    const shifted = new Date(end.toMillis() + TWELVE_HOURS_MS);

    if (localHour(endDate) >= 12) {
      skipped.push(`${name}: end ${stamp(endDate)} is not an AM time`);
      return;
    }
    if (shifted.getTime() <= start.toMillis()) {
      skipped.push(`${name}: +12h still lands before the start`);
      return;
    }
    if (localDay(shifted) !== localDay(endDate)) {
      skipped.push(`${name}: +12h crosses a day boundary (DST?)`);
      return;
    }
    plan.push({ ref: doc.ref, name, start: start.toDate(), from: endDate, to: shifted });
  });

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${resolveProjectId(project)}"\n`);
  plan.forEach((p, i) =>
    console.log(`${String(i + 1).padStart(2)}. ${p.name}\n      ${stamp(p.start)}  ends ${stamp(p.from)}  ->  ${stamp(p.to)}`));
  skipped.forEach((s) => console.log(`  SKIPPED  ${s}`));
  console.log(`\n${plan.length} to fix, ${skipped.length} skipped`);

  if (!execute || !plan.length) {
    if (!execute) console.log("[dry-run] nothing written. Re-run with --execute to apply.");
    return;
  }

  const batch = db.batch();
  plan.forEach((p) => batch.update(p.ref, { endDate: Timestamp.fromDate(p.to) }));
  await batch.commit();
  console.log(`fixed ${plan.length} event end time(s)`);
})().catch((e) => { console.error(e); process.exit(1); });
