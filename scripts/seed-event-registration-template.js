#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Creates "Event Registration Confirmation" - a GENERIC registration
// confirmation that works for any event, authored as email-builder blocks.
//
// Why it has to exist. Every other event template in the data is specific to
// something: Whitewater Campus Receipt hardcodes a venue, Impact
// Disciple-Making Network hardcodes a date that has already passed,
// Disciple-Making Church Seminar Receipt names that one seminar, and
// "Seminar Template" is not a confirmation at all - it is an internal staff
// notification from the retired Seminar Request form. So five active
// Disciple-Making Pastor Equipping Groups were left pointing at "Sales
// Receipt", which mails registrants an email titled "Sales Receipt from
// Impact Ministries", and one active event ("NEW! Disciple-Making Church
// Pastor Ken Adams") had no template at all and sent nothing.
//
// This one names nothing. {{eventName}} and {{startDate}} come from the
// event, so the same template serves all of them and every future event.
//
//   node scripts/seed-event-registration-template.js --project=dev
//   ... add --execute to write. --assign also points the events that need it
//   at this template (dry-run listed first, always).
//
// Idempotent by name: re-running updates the design in place rather than
// creating a second one. Nothing sends by kind - the event resolves its
// template by NAME - so the name below is load-bearing.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const NAME = "Event Registration Confirmation";
// Only {{eventName}} is substituted in a SUBJECT (event-registration.
// functions.ts does one literal String.replace on it) - no other token works
// there, so do not add one.
const SUBJECT = "You're registered for {{eventName}}";
const OUT_DIR = path.join(__dirname, "output");

// {{...}} rather than *|TAG|*: eventName/startDate/editRegistration are
// arbitrary keys the event send path supplies, not entries in the closed
// MERGE_TAGS list, so they have no *|TAG|* spelling at all. firstName does,
// but writing it the same way as its neighbours keeps the body consistent -
// renderEmailBody resolves both syntaxes in one pass either way.
const BLOCKS = [
  { section: 1, type: "heading", html: "You're registered!", level: 2 },
  { section: 1, type: "text", html: "<p>Hi {{firstName}},</p>" },
  {
    section: 1,
    type: "text",
    html:
      "<p>Thank you for registering for <strong>{{eventName}}</strong>. " +
      "We're glad you're joining us.</p>"
  },
  // Its own block, deliberately: an event with no start date renders this as
  // an empty line rather than stranding a dangling "starting ." mid-sentence.
  { section: 1, type: "text", html: "<p><strong>When:</strong> {{startDate}}</p>" },
  {
    section: 1,
    type: "text",
    html:
      "<p>We look forward to seeing you there as we grow together in " +
      "becoming and building disciples of Jesus.</p>"
  },
  {
    section: 2,
    type: "text",
    html:
      "<p style=\"color:#6a7280;font-size:12px;\">Questions? Reply to this " +
      "email or contact us at <a href=\"mailto:info@impactdisciples.com\">" +
      "info@impactdisciples.com</a>.</p>"
  }
];

// Events that should be pointed at this template: the ones mailing a "Sales
// Receipt" as a registration confirmation, plus any ACTIVE event with no
// template at all (which sends nothing today).
const REASSIGN_FROM = "Sales Receipt";

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

function loadEmailModules() {
  const root = path.join(__dirname, "..", "src", "app", "common");
  const entry = path.join(os.tmpdir(), `evt-tpl-entry-${process.pid}.ts`);
  const toImport = (p) => JSON.stringify(p.split(path.sep).join("/"));
  fs.writeFileSync(
    entry,
    `export * from ${toImport(path.join(root, "models", "admin", "email-design.model"))};\n` +
    `export * from ${toImport(path.join(root, "utils", "email", "email-design-compiler"))};\n`,
    "utf8"
  );
  try {
    const built = esbuild.buildSync({
      entryPoints: [entry], bundle: true, format: "cjs",
      platform: "node", target: "node18", write: false, logLevel: "silent"
    });
    const outFile = path.join(os.tmpdir(), `evt-tpl-bundle-${process.pid}.js`);
    fs.writeFileSync(outFile, built.outputFiles[0].text, "utf8");
    try {
      return require(outFile);
    } finally {
      fs.unlinkSync(outFile);
    }
  } finally {
    fs.unlinkSync(entry);
  }
}

function buildDesign(mod) {
  const design = mod.createDefaultDesign();
  design.globalStyles.desktop.heading.fontFamily = "Helvetica, Arial, sans-serif";
  design.globalStyles.desktop.paragraph.color = "#333333";
  for (const section of design.sections) {
    section.rows = [];
  }
  for (const spec of BLOCKS) {
    const section = design.sections[spec.section];
    if (!section.rows.length) {
      section.rows = [mod.createRow(1)];
    }
    const block = mod.createBlock(spec.type);
    block.props.html = spec.html;
    if (spec.level) block.props.level = spec.level;
    block.styles.align = "left";
    section.rows[0].columns[0].blocks.push(block);
  }
  return design;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = getFirestoreFor(projectId);
  const mod = loadEmailModules();
  const design = buildDesign(mod);
  const html = mod.compileEmailDesign(design, { title: NAME });

  // Every token must survive the compile. One that does not is mailed to a
  // registrant verbatim, and nothing errors anywhere.
  const required = ["{{firstName}}", "{{eventName}}", "{{startDate}}"];
  const missing = required.filter((t) => !html.includes(t));
  if (missing.length) {
    throw new Error(`Tokens lost in the compile: ${missing.join(", ")}`);
  }

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  template : ${NAME}`);
  console.log(`  subject  : ${SUBJECT}`);
  console.log(`  kind     : event`);
  console.log(`  tokens verified intact: ${required.join("  ")}`);

  const preview = path.join(OUT_DIR, `template-preview-event-registration-${projectId}.html`);
  fs.writeFileSync(preview, html, "utf8");
  console.log(`  preview  : ${preview}`);

  const existing = await tenantCollection(db, "mail_templates")
    .where("name", "==", NAME).get();
  if (existing.size > 1) {
    throw new Error(`${existing.size} templates already named "${NAME}".`);
  }
  console.log(`  action   : ${existing.empty ? "CREATE" : `update ${existing.docs[0].id}`}`);

  // Who would be pointed at it.
  const events = await tenantCollection(db, "events").get();
  const toAssign = [];
  events.forEach((d) => {
    const e = d.data();
    if (e.isActive === false) return;
    if (e.emailTemplate === REASSIGN_FROM || !e.emailTemplate) {
      toAssign.push({ id: d.id, name: e.eventName ?? "(untitled)", was: e.emailTemplate ?? "(none)" });
    }
  });

  console.log("");
  console.log(`  active events that would be reassigned: ${toAssign.length}`);
  toAssign.forEach((e) => console.log(`    ${e.was.padEnd(15)} -> ${e.name}`));
  if (!args.assign) {
    console.log("    (pass --assign to actually repoint them)");
  }

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  const value = { name: NAME, subject: SUBJECT, kind: "event", html, design, attachments: [] };
  let id;
  if (existing.empty) {
    id = (await tenantCollection(db, "mail_templates").add(value)).id;
  } else {
    id = existing.docs[0].id;
    await existing.docs[0].ref.update(value);
  }
  console.log("");
  console.log(`  written: ${id}`);

  if (args.assign) {
    // Recorded per event so a mistake can be undone by hand - there are only
    // a handful, and each one is a live event mailing real registrants.
    const log = path.join(OUT_DIR, `event-template-reassign-${projectId}.json`);
    fs.writeFileSync(log, JSON.stringify({ project: projectId, to: NAME, events: toAssign }, null, 2), "utf8");
    for (const e of toAssign) {
      await tenantCollection(db, "events").doc(e.id).update({ emailTemplate: NAME });
    }
    console.log(`  reassigned ${toAssign.length} event(s). Undo list: ${log}`);
  }
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
