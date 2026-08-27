#!/usr/bin/env node
// Converts the "Amazon Shipping Confirmation" mail_template from a legacy
// Quill (html-only) doc into a BUILDER template, by authoring its content as
// real designer blocks and stamping `design` + a recompiled `html`.
//
// Why a data script and not a code change: EmailTemplateEditorService.open()
// branches on `template.design` - present opens the full-screen builder,
// absent opens the Quill dialog. The doc already exists on both projects, so
// the only way to switch editors is to give it a design.
//
// THE CONTENT IS VERBATIM. Same words, same merge tags, same order as the
// html that is live today; only the markup structure changes, from one
// <div> of flowed html into six independently editable blocks. Two global
// style overrides keep the SENT email looking like it does now (the builder
// defaults to a Georgia heading and #454d58 body text; today's email is
// Helvetica throughout on #333).
//
// SAFE TO TRY, SAFE TO UNDO:
//   dry run (default) - compiles, verifies, writes an .html preview you can
//                       open in a browser, and touches Firestore not at all
//   --execute         - backs the doc up to scripts/output/ FIRST, then writes
//   --revert          - restores that backup: old html back, `design` DELETED
//                       (FieldValue.delete(), so the doc returns to exactly
//                       the shape it has now) and the Fulfillment button goes
//                       back to opening the Quill dialog
//
//   node scripts/convert-amazon-template-to-builder.js --project=dev
//   node scripts/convert-amazon-template-to-builder.js --project=dev --execute
//   node scripts/convert-amazon-template-to-builder.js --project=dev --revert
//
// The compile uses the APP'S OWN compiler, bundled out of src/ by esbuild at
// run time rather than reimplemented here - a second copy of the block
// renderer would drift from the one that renders every other email.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { resolveProjectId, getFirestoreFor, firestore } = require("./lib/firestore-admin");

const NAME = "Amazon Shipping Confirmation";
const OUT_DIR = path.join(__dirname, "output");

// Every merge tag that must survive the round trip, checked BYTE-INTACT
// against the compiled html. renderMergeTags() in purchases.service.ts
// matches these literally, so an escaped apostrophe or a mangled pipe stops
// the substitution and mails the raw tag to a customer.
const REQUIRED_TAGS = [
  "*|FNAME|*",
  "*|TRACKING|You'll receive delivery updates directly from Amazon.|*"
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

// Bundles the pure-TS design model + compiler into one CJS module and loads
// it. Both files are Angular-free by design (see their header comments),
// which is the whole reason this is possible.
function loadEmailModules() {
  const root = path.join(__dirname, "..", "src", "app", "common");
  const entry = path.join(os.tmpdir(), `email-design-entry-${process.pid}.ts`);
  const toImport = (p) => JSON.stringify(p.split(path.sep).join("/"));
  fs.writeFileSync(
    entry,
    `export * from ${toImport(path.join(root, "models", "admin", "email-design.model"))};\n` +
    `export * from ${toImport(path.join(root, "utils", "email", "email-design-compiler"))};\n`,
    "utf8"
  );
  try {
    const built = esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node18",
      write: false,
      logLevel: "silent"
    });
    const outFile = path.join(os.tmpdir(), `email-design-bundle-${process.pid}.js`);
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

// The email, as blocks. Each entry becomes one block in the designer, so
// every line below is something an admin can restyle, reorder, or delete on
// its own - which is the entire point of the switch.
const BLOCKS = [
  { section: 1, type: "heading", html: "Your order is on its way!", level: 2 },
  { section: 1, type: "text", html: "<p>Hi *|FNAME|*,</p>" },
  {
    section: 1,
    type: "text",
    html:
      "<p>Good news - your Impact Disciples order has shipped and is being " +
      "delivered via <b>Amazon</b>.</p>"
  },
  {
    section: 1,
    type: "text",
    // The inline-fallback tag: the send passes "Tracking: <value>" when the
    // admin entered one, otherwise this sentence renders in its place.
    html: "<p>*|TRACKING|You'll receive delivery updates directly from Amazon.|*</p>"
  },
  {
    section: 1,
    type: "text",
    html: "<p>Thank you for supporting the mission of Impact Disciples!</p>"
  },
  {
    section: 2,
    type: "text",
    html:
      "<p style=\"color:#6a7280;font-size:12px;\">If you have any questions " +
      "about your order, just reply to this email.</p>"
  }
];

function buildDesign(mod) {
  const design = mod.createDefaultDesign();

  // Match the email that goes out today rather than the builder's defaults:
  // its heading is Helvetica (inherited from the wrapper div, not Georgia)
  // and its body text is #333. Both are editable in the Styles panel after.
  design.globalStyles.desktop.heading.fontFamily = "Helvetica, Arial, sans-serif";
  design.globalStyles.desktop.paragraph.color = "#333333";

  // sections = [header, body, footer]. The header stays empty, as the live
  // email has no logo or masthead - there is now somewhere to put one.
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
    // Blocks default to centred; the original is flowed left-aligned text.
    block.styles.align = "left";
    section.rows[0].columns[0].blocks.push(block);
  }

  return design;
}

function backupPath(projectId) {
  return path.join(OUT_DIR, `amazon-template-backup-${projectId}.json`);
}

async function findTemplate(db) {
  const snap = await db.collection("mail_templates").where("name", "==", NAME).get();
  if (snap.empty) throw new Error(`No template named "${NAME}" on this project.`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${NAME}" - resolve the duplicate first.`);
  return snap.docs[0];
}

async function revert(db, projectId, execute) {
  const file = backupPath(projectId);
  if (!fs.existsSync(file)) {
    throw new Error(`No backup at ${file} - nothing to revert to on ${projectId}.`);
  }
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const doc = await findTemplate(db);
  if (doc.id !== backup.id) {
    throw new Error(`Backup is for doc ${backup.id} but the live template is ${doc.id}.`);
  }

  console.log(`  backup     : ${file}`);
  console.log(`  taken      : ${backup.takenAt}`);
  console.log(`  restores   : html (${backup.html.length} chars), and DELETES design`);
  console.log(`  editor then: rich text dialog, on Contacts Manager > Fulfillment`);
  if (!execute) return console.log("\n  Dry run - nothing written. Re-run with --execute.");

  await doc.ref.update({
    html: backup.html,
    subject: backup.subject,
    // Delete rather than write null: an absent `design` is exactly the shape
    // the doc has today, and it is what open() reads as "legacy".
    design: firestore.FieldValue.delete()
  });
  const after = (await doc.ref.get()).data();
  console.log(`\n  reverted. has design: ${!!after.design}  html: ${String(after.html).length} chars`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  template : ${NAME}`);

  if (args.revert === true) {
    console.log("  action   : REVERT to legacy rich text\n");
    return revert(db, projectId, execute);
  }

  const doc = await findTemplate(db);
  const current = doc.data();
  const mod = loadEmailModules();
  const design = buildDesign(mod);
  const html = mod.compileEmailDesign(design, { title: NAME });

  // Refuse to write a template whose merge tags did not survive compilation.
  // A tag that renders literally is worse than no change at all: the customer
  // gets "*|FNAME|*" in their inbox and nothing errors anywhere.
  const missing = REQUIRED_TAGS.filter((tag) => !html.includes(tag));
  if (missing.length) {
    throw new Error(
      "Merge tags did not survive the compile, so nothing was written:\n    " +
      missing.join("\n    ")
    );
  }

  const blockCount = design.sections.reduce(
    (n, s) => n + s.rows.reduce((m, r) => m + r.columns.reduce((k, c) => k + c.blocks.length, 0), 0),
    0
  );

  console.log(`  doc id   : ${doc.id}`);
  console.log(`  kind     : ${current.kind}`);
  console.log(`  now      : ${current.design ? "builder" : "legacy rich text"}  (${String(current.html ?? "").length} chars of html)`);
  console.log(`  after    : builder, ${blockCount} blocks  (${html.length} chars of html)`);
  console.log(`  merge tags verified intact: ${REQUIRED_TAGS.join("  ")}`);

  const preview = path.join(OUT_DIR, `amazon-template-preview-${projectId}.html`);
  fs.writeFileSync(preview, html, "utf8");
  console.log(`  preview  : ${preview}`);
  console.log("             (open it in a browser - this is byte-for-byte what would be sent,");
  console.log("              merge tags unsubstituted)");

  if (!execute) {
    console.log("\n  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  // The backup goes down BEFORE the write, and is the undo.
  const file = backupPath(projectId);
  fs.writeFileSync(file, JSON.stringify({
    project: projectId,
    id: doc.id,
    name: NAME,
    takenAt: new Date().toISOString(),
    subject: current.subject ?? "",
    html: current.html ?? "",
    hadDesign: !!current.design,
    design: current.design ?? null
  }, null, 2), "utf8");
  console.log(`\n  backed up to: ${file}`);

  await doc.ref.update({ design, html });
  const after = (await doc.ref.get()).data();
  console.log(`  written. has design: ${!!after.design}  html: ${String(after.html).length} chars`);
  console.log(`  It now opens in the email builder from Contacts Manager > Fulfillment.`);
  console.log(`  Undo with: node scripts/convert-amazon-template-to-builder.js --project=${args.project} --revert --execute`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
