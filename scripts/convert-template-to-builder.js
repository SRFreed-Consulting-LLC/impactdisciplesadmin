#!/usr/bin/env node
// Converts a legacy Quill (html-only) mail_template into a BUILDER template,
// by authoring its content as real designer blocks and stamping `design` +
// a recompiled `html`.
//
// Why a data script and not a code change: EmailTemplateEditorService.open()
// branches on `template.design` - present opens the full-screen builder,
// absent opens the Quill dialog. The docs already exist on both projects, so
// the only way to switch editors is to give one a design.
//
// CONTENT IS VERBATIM unless an entry says otherwise below. Same words, same
// order, same merge tags; only the markup structure changes, from one lump of
// flowed html into separately editable blocks. Where a template's live html
// carries an outright defect (a broken href), the fix is called out in that
// template's own `changes` list and printed on every run - never applied
// silently.
//
// SAFE TO TRY, SAFE TO UNDO:
//   dry run (default) - compiles, verifies, writes an .html preview you can
//                       open in a browser, and touches Firestore not at all
//   --execute         - backs the doc up to scripts/output/ FIRST, then writes
//   --revert          - restores that backup: old html back, `design` DELETED
//                       (FieldValue.delete(), so the doc returns to exactly
//                       the shape it had) and the template goes back to the
//                       rich text dialog
//
//   node scripts/convert-template-to-builder.js --project=dev --list
//   node scripts/convert-template-to-builder.js --project=dev --name="..."
//   node scripts/convert-template-to-builder.js --project=dev --name="..." --execute
//   node scripts/convert-template-to-builder.js --project=dev --name="..." --revert --execute
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

const OUT_DIR = path.join(__dirname, "output");

// ---------------------------------------------------------------- templates
//
// One entry per template, keyed by the `name` field the senders resolve it
// by. `blocks` is the authored design: `section` 0/1/2 = header/body/footer.
// `requiredTags` are checked BYTE-INTACT against the compiled html and the
// write is refused if any is missing - a tag that renders literally mails
// "*|FNAME|*" to a customer and nothing errors anywhere.
const TEMPLATES = {
  "Amazon Shipping Confirmation": {
    // Sent by PurchasesService.sendAmazonConfirmation, which renders with
    // renderMergeTags - so *|TAG|* is this template's native syntax.
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#333333" },
    requiredTags: [
      "*|FNAME|*",
      "*|TRACKING|You'll receive delivery updates directly from Amazon.|*"
    ],
    changes: [],
    blocks: [
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
        // The inline-fallback tag: the send passes "Tracking: <value>" when
        // the admin entered one, otherwise this sentence renders instead.
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
    ]
  },

  "Healthy Marriage Videos": {
    // A product follow-up (kind 'product'), sent by queueWebOrderEmails.
    // That path renders with renderMergeTags as of 2026-08-27, so *|FNAME|*
    // and the legacy {{firstName}} both resolve - the tag is written in the
    // builder's own syntax here so the editor's tag menu recognises it.
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#242424" },
    requiredTags: ["*|FNAME|*"],
    changes: [
      "{{firstName}} -> *|FNAME|* (identical output; the builder's tag menu " +
        "only recognises its own syntax)",
      "the contact link's href was the literal string \"[object Object]\" - " +
        "an object stringified into it - and is now mailto:info@impactdisciples.com",
      "Quill's inline background-color/font-size spans dropped in favour of " +
        "the email-wide styles (same rendered size and colour)"
    ],
    blocks: [
      { section: 1, type: "text", html: "<p>Hi *|FNAME|*,</p>" },
      {
        section: 1,
        type: "text",
        // "!." is verbatim from the live template - reported, not fixed.
        html:
          "<p>Thank you for your recent order of <em>How to Have a Healthy " +
          "Marriage</em>!.  Click the link below for the introductory videos.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>🎥 <strong><a href=\"https://youtube.com/playlist?" +
          "list=PL4dQQClE4a77wbBowIOG92JdWQxe08oZX&amp;si=aCHnectw7AWijdc1\" " +
          "rel=\"noopener noreferrer\" target=\"_blank\">Watch the Videos here: " +
          "</a></strong></p>"
      },
      {
        section: 1,
        type: "text",
        html: "<p>Please keep this link private and do not share it publicly.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>If you have any questions or need assistance, contact us at " +
          "<strong><a href=\"mailto:info@impactdisciples.com\">" +
          "info@impactdisciples.com</a></strong>.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>We pray this study will strengthen your marriage and draw you " +
          "closer to Christ and each other.</p>"
      },
      {
        section: 2,
        type: "text",
        html:
          "<p>With appreciation,</p>" +
          "<p><strong>The Impact Discipleship Ministries Team</strong></p>"
      }
    ]
  }
};

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

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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

function buildDesign(mod, spec) {
  const design = mod.createDefaultDesign();

  // Match the email that goes out today rather than the builder's defaults.
  // Both are editable in the Styles panel afterwards.
  if (spec.globalStyles?.headingFont) {
    design.globalStyles.desktop.heading.fontFamily = spec.globalStyles.headingFont;
  }
  if (spec.globalStyles?.paragraphColor) {
    design.globalStyles.desktop.paragraph.color = spec.globalStyles.paragraphColor;
  }

  // sections = [header, body, footer]. An empty header is deliberate where
  // the live email has no masthead - there is now somewhere to put one.
  for (const section of design.sections) {
    section.rows = [];
  }

  for (const blockSpec of spec.blocks) {
    const section = design.sections[blockSpec.section];
    if (!section.rows.length) {
      section.rows = [mod.createRow(1)];
    }
    const block = mod.createBlock(blockSpec.type);
    block.props.html = blockSpec.html;
    if (blockSpec.level) block.props.level = blockSpec.level;
    // Blocks default to centred; these are flowed left-aligned text.
    block.styles.align = "left";
    section.rows[0].columns[0].blocks.push(block);
  }

  return design;
}

function backupPath(name, projectId) {
  const current = path.join(OUT_DIR, `template-backup-${slug(name)}-${projectId}.json`);
  if (fs.existsSync(current)) return current;
  // The Amazon conversion ran from an earlier, single-template script that
  // named its backup differently. Honour that name so its undo still works.
  const legacy = path.join(OUT_DIR, `amazon-template-backup-${projectId}.json`);
  if (name === "Amazon Shipping Confirmation" && fs.existsSync(legacy)) return legacy;
  return current;
}

async function findTemplate(db, name) {
  const snap = await db.collection("mail_templates").where("name", "==", name).get();
  if (snap.empty) throw new Error(`No template named "${name}" on this project.`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${name}" - resolve the duplicate first.`);
  return snap.docs[0];
}

async function revert(db, projectId, name, execute) {
  const file = backupPath(name, projectId);
  if (!fs.existsSync(file)) {
    throw new Error(`No backup at ${file} - nothing to revert to on ${projectId}.`);
  }
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const doc = await findTemplate(db, name);
  if (doc.id !== backup.id) {
    throw new Error(`Backup is for doc ${backup.id} but the live template is ${doc.id}.`);
  }

  console.log(`  backup     : ${file}`);
  console.log(`  taken      : ${backup.takenAt}`);
  console.log(`  restores   : html (${backup.html.length} chars), and DELETES design`);
  if (!execute) return console.log("\n  Dry run - nothing written. Re-run with --execute.");

  await doc.ref.update({
    html: backup.html,
    subject: backup.subject,
    // Delete rather than write null: an absent `design` is exactly the shape
    // the doc had, and it is what open() reads as "legacy".
    design: firestore.FieldValue.delete()
  });
  const after = (await doc.ref.get()).data();
  console.log(`\n  reverted. has design: ${!!after.design}  html: ${String(after.html).length} chars`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list === true) {
    console.log("Templates this script can convert:");
    for (const [name, spec] of Object.entries(TEMPLATES)) {
      console.log(`  ${name}  (${spec.blocks.length} blocks)`);
    }
    return;
  }

  const name = args.name;
  if (!name) throw new Error('Pass --name="<template name>". Use --list to see them.');
  const spec = TEMPLATES[name];
  if (!spec) {
    throw new Error(
      `No authored design for "${name}". Add one to TEMPLATES in this file - ` +
      "the blocks have to be written by hand, on purpose: a mechanical import " +
      "produces one lump of rich text and gains nothing."
    );
  }

  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  template : ${name}`);

  if (args.revert === true) {
    console.log("  action   : REVERT to legacy rich text\n");
    return revert(db, projectId, name, execute);
  }

  const doc = await findTemplate(db, name);
  const current = doc.data();
  const mod = loadEmailModules();
  const design = buildDesign(mod, spec);
  const html = mod.compileEmailDesign(design, { title: name });

  // Refuse to write a template whose merge tags did not survive compilation.
  // A tag that renders literally is worse than no change at all: the customer
  // gets "*|FNAME|*" in their inbox and nothing errors anywhere.
  const missing = (spec.requiredTags ?? []).filter((tag) => !html.includes(tag));
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
  console.log(`  kind     : ${current.kind ?? "(absent, reads as system)"}`);
  console.log(`  now      : ${current.design ? "builder" : "legacy rich text"}  (${String(current.html ?? "").length} chars of html)`);
  console.log(`  after    : builder, ${blockCount} blocks  (${html.length} chars of html)`);
  if (spec.requiredTags?.length) {
    console.log(`  merge tags verified intact: ${spec.requiredTags.join("  ")}`);
  }

  if (spec.changes?.length) {
    console.log("");
    console.log("  NOT verbatim - these are deliberate:");
    spec.changes.forEach((c) => console.log(`    - ${c}`));
  }

  const preview = path.join(OUT_DIR, `template-preview-${slug(name)}-${projectId}.html`);
  fs.writeFileSync(preview, html, "utf8");
  console.log("");
  console.log(`  preview  : ${preview}`);
  console.log("             (open it in a browser - this is byte-for-byte what would be sent,");
  console.log("              merge tags unsubstituted)");

  if (!execute) {
    console.log("\n  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  // The backup goes down BEFORE the write, and is the undo.
  const file = backupPath(name, projectId);
  fs.writeFileSync(file, JSON.stringify({
    project: projectId,
    id: doc.id,
    name,
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
  console.log("  It now opens in the email builder.");
  console.log(
    `  Undo with: node scripts/convert-template-to-builder.js --project=${args.project} ` +
    `--name="${name}" --revert --execute`
  );
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
