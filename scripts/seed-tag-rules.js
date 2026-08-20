#!/usr/bin/env node
// Seeds the 2026-08-20 tag-rule set (user-specified: Impact 1-4 books,
// Digital, DMC books, COACH, Summit paid/free, DMP events, DMC events)
// into `tag_rules`. Deterministic doc ids make re-runs idempotent (a
// re-run overwrites the same 10 docs, never duplicates). Product/event
// ids are hardcoded from the catalog (dev and prod share ids - dev's data
// was imported from prod with ids preserved); every referenced id is
// VERIFIED to exist and its title printed before anything is written, so
// a drifted catalog aborts the run instead of seeding a dead rule.
//
// Usage:
//   node scripts/seed-tag-rules.js --project=dev            # dry-run
//   node scripts/seed-tag-rules.js --project=dev --execute
//
// Backfilling historic purchases/registrations is a separate step - see
// scripts/backfill-tag-rules.js (or the per-rule "Apply to Existing"
// button on Campaigns Manager > Tag Rules).

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {Timestamp} = require(
  require.resolve("firebase-admin/firestore", {
    paths: [require("path").join(__dirname, "..", "functions")],
  })
);

const PRODUCTS = {
  impactOne: "POrJLb4rKUhz1qiFaTx8", // Impact One: Disciple Making Essentials
  impactOneDigital: "4ro577brOE1gPMdzECX5", // Impact One - Digital
  impactoUno: "623xQZ8G456N8RTmWakB", // Impacto Uno: Esenciales del Discipulado
  impactoUnoInteractive: "Fgyqag37s39066ukwp3h", // Impacto Uno (Interactive)
  impactTwo: "jxpUmPrgDj9DmpwcCG5H", // Impact Two: The M-7 Project - Character
  impactTwoDigital: "UhXlNR7PfNX0kQRFvLdl", // Impact Two - Digital
  impactoDos: "RduhmBi8X3KjEdpPLA58", // Impacto Dos: El Caracter de Cristo
  impactThree: "ke9jR5Ra6fQUSITp0gu9", // Impact Three: The M-7 Project - Conduct
  impactThreeDigital: "jsWN2Gm4GQBIF9w5jirk", // Impact Three - Digital
  impactFour: "G8iNsHZQEOfyPexiN0Un", // Impact Four: 315 Leadership Training
  impactFourDigital: "RScJS00ykOPEd2h5heFJ", // Impact Four - Digital
  impactSeriesBundle: "N1iSzHPPhCh84SkEbt0J", // Impact Series (all 4 books)
  dmcSeriesBundle: "Cv4KGGMXYHljTFoNUNTd", // Disciple-Making Church Series
  fullyTrainedDisciples: "vtBTNyJhzRhKBVJs3WzG",
  nextSteps: "NY5x6y5siwplYpnb8QaP",
  firstThirtyDaysChurch: "kZCgC0NUrgDuTi1kCZRh",
  firstThirtyDaysPastor: "mbWhQUorUg4fO6Euo1hr",
  powerOfMultiplication: "f7RIuCnPYQ1vjpmZXuw3",
  coachingWithImpact: "rySK3NIIjWwWuBLTpxPc",
  competingWithImpact: "Th0IrFrIUElnj5urBzl6",
};

const EVENTS = {
  elevateDmpSeminar: "uhRnsdfaKcguLCRbK5DA",
  dmpOnlineLance: "opH4W4jWGK2nh8THX2xS",
  dmpOnlineMike: "ljmOpAHJTbaSbCUP4dbI",
  dmpRonLance: "Km7DuN1H86wAZRoELJX1",
  dmpLance2026: "qhaOkMpiKnu7eMzMDUkF",
  // "NEW! Disciple-Making Church Pastor Ken Adams" - user decision
  // 2026-08-20: counts as BOTH a DMP and a DMC event.
  dmcPastorKenAdams: "v9OLWwU9EkV5T32h5TPo",
  dmpInPerson2026: "DqY3PjPFW8bytSbow7JW",
  dmpOnlineMarch2026: "HoAy5bM1HdeHNeCqwfrl",
  dmpOnlineJune2026: "4mMAVT9NgMixr1IhBmmW",
  dmpWesternBaptist2026: "FZm7QYTQjdclDtuThlV3",
  elevateDmcSeminar: "LZr18AhbZuFwsnHkWXUn",
  sunCityDmc: "o9QywnbAyAByAEreU1GI",
  whitewaterDmc: "tLTg73EWOx93CeB0nz8C",
  riverbendDmc: "Ff7mvP58l8jWg3Fwmcg9",
  redBankDmc: "sap5voV0KNRzYfwDAX5F",
  centralBaptistDmc: "0fJe8dxCFqdokeHZ4oVW",
  crossPointeDmc: "tpRVezdYSoLhVOkHLnnC",
  // The next four don't say "DMC" in their names but are DMC seminars -
  // user decision 2026-08-20 (all four confirmed).
  firstBaptistDeLeon: "XIEkadRlXYAFIApEiT8U",
  tabernacleBaptist: "WsuXFGX0jUjLcQixJ6qN",
  smithsStationBaptist: "QlhJLyVLHqV9Wm2FCeX1",
  awakenChurch: "vt3JxPgIh0wPIihv2G4M",
};

const P = PRODUCTS;
const E = EVENTS;

// Doc id => rule. The Impact Series bundle appears in all four Impact
// rules (buying the 4-book bundle tags all four); the digital editions
// appear both in their book's rule AND the Digital rule; Ken Adams's
// event is in both DMP and DMC (user decisions, 2026-08-20).
const RULES = [
  {docId: "impact-1-book", rule: {name: "Impact 1 book", trigger: "purchase", tag: "Impact 1",
    productIds: [P.impactOne, P.impactOneDigital, P.impactoUno, P.impactoUnoInteractive, P.impactSeriesBundle]}},
  {docId: "impact-2-book", rule: {name: "Impact 2 book", trigger: "purchase", tag: "Impact 2",
    productIds: [P.impactTwo, P.impactTwoDigital, P.impactoDos, P.impactSeriesBundle]}},
  {docId: "impact-3-book", rule: {name: "Impact 3 book", trigger: "purchase", tag: "Impact 3",
    productIds: [P.impactThree, P.impactThreeDigital, P.impactSeriesBundle]}},
  {docId: "impact-4-book", rule: {name: "Impact 4 book", trigger: "purchase", tag: "Impact 4",
    productIds: [P.impactFour, P.impactFourDigital, P.impactSeriesBundle]}},
  {docId: "impact-digital", rule: {name: "Impact digital editions", trigger: "purchase", tag: "Digital",
    productIds: [P.impactOneDigital, P.impactTwoDigital, P.impactThreeDigital, P.impactFourDigital]}},
  {docId: "dmc-books", rule: {name: "DMC Series books", trigger: "purchase", tag: "DMC",
    productIds: [P.dmcSeriesBundle, P.fullyTrainedDisciples, P.nextSteps,
      P.firstThirtyDaysChurch, P.firstThirtyDaysPastor, P.powerOfMultiplication]}},
  {docId: "coach-books", rule: {name: "Coaches books", trigger: "purchase", tag: "COACH",
    productIds: [P.coachingWithImpact, P.competingWithImpact]}},
  {docId: "summit-registration", rule: {name: "Summit registration", trigger: "summit-registration",
    tag: "Summit", paidTag: "Paid Summit"}},
  {docId: "dmp-events", rule: {name: "DMP events", trigger: "event-registration", tag: "DMP",
    eventIds: [E.elevateDmpSeminar, E.dmpOnlineLance, E.dmpOnlineMike, E.dmpRonLance,
      E.dmpLance2026, E.dmcPastorKenAdams, E.dmpInPerson2026, E.dmpOnlineMarch2026,
      E.dmpOnlineJune2026, E.dmpWesternBaptist2026]}},
  {docId: "dmc-events", rule: {name: "DMC events", trigger: "event-registration", tag: "DMC",
    eventIds: [E.elevateDmcSeminar, E.sunCityDmc, E.whitewaterDmc, E.riverbendDmc,
      E.redBankDmc, E.centralBaptistDmc, E.crossPointeDmc, E.firstBaptistDeLeon,
      E.tabernacleBaptist, E.smithsStationBaptist, E.awakenChurch, E.dmcPastorKenAdams]}},
];

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

/**
 * Verifies every referenced product/event id exists; prints titles.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<boolean>} Whether all references resolve.
 */
async function verifyReferences(db) {
  let ok = true;
  const check = async (collection, ids, nameField) => {
    const names = new Map();
    for (const id of ids) {
      const snap = await db.collection(collection).doc(id).get();
      if (!snap.exists) {
        console.error(`  MISSING ${collection}/${id}`);
        ok = false;
      } else {
        names.set(id, snap.data()[nameField] ?? "(untitled)");
      }
    }
    return names;
  };
  const productIds = new Set(RULES.flatMap((r) => r.rule.productIds ?? []));
  const eventIds = new Set(RULES.flatMap((r) => r.rule.eventIds ?? []));
  const productNames = await check("products", productIds, "title");
  const eventNames = await check("events", eventIds, "eventName");

  for (const {docId, rule} of RULES) {
    console.log(`\ntag_rules/${docId} — "${rule.name}" [${rule.trigger}]`);
    if (rule.trigger === "summit-registration") {
      console.log(`  any isSummit event => paid: "${rule.paidTag}" / free: "${rule.tag}"`);
      continue;
    }
    const ids = rule.productIds ?? rule.eventIds;
    const names = rule.productIds ? productNames : eventNames;
    for (const id of ids) {
      console.log(`  ${id}  ${names.get(id) ?? "?? MISSING ??"}`);
    }
    console.log(`  => tag "${rule.tag}"`);
  }
  return ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  console.log(`Seeding ${RULES.length} tag rules into ${projectId}` +
    (args.execute ? "" : " (DRY RUN - pass --execute to write)"));

  if (!(await verifyReferences(db))) {
    console.error("\nAborting: some referenced products/events do not exist " +
      "in this project. Fix the id map before seeding.");
    process.exit(1);
  }
  if (!args.execute) {
    console.log("\nDry run complete - nothing written.");
    return;
  }

  for (const {docId, rule} of RULES) {
    // Explicit nulls for the unused shape fields (Firestore write gotcha:
    // never a literal undefined) + preserve createdDate on re-runs.
    const existing = await db.collection("tag_rules").doc(docId).get();
    await db.collection("tag_rules").doc(docId).set({
      name: rule.name,
      trigger: rule.trigger,
      productId: null,
      eventId: null,
      productIds: rule.productIds ?? null,
      eventIds: rule.eventIds ?? null,
      tag: rule.tag,
      paidTag: rule.paidTag ?? null,
      active: true,
      createdDate: existing.exists ?
        (existing.data().createdDate ?? Timestamp.now()) : Timestamp.now(),
    });
    console.log(`  wrote tag_rules/${docId}`);
  }
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
