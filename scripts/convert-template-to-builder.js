#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
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
        "the email-wide styles (same rendered size and colour)",
      "\"Marriage!.  Click\" -> \"Marriage! Click\" - a stray period after the " +
        "exclamation mark, and the doubled space with it (owner approved)"
    ],
    blocks: [
      { section: 1, type: "text", html: "<p>Hi *|FNAME|*,</p>" },
      {
        section: 1,
        type: "text",
        html:
          "<p>Thank you for your recent order of <em>How to Have a Healthy " +
          "Marriage</em>! Click the link below for the introductory videos.</p>"
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
  },

  "Sales Receipt": {
    // Sent by queueWebOrderEmails for every web order, resolved by this
    // literal name. Renders with renderEmailBody, so {{...}} and *|TAG|*
    // both work - {{product_list}} is an arbitrary caller key, not a merge
    // tag, and only the former covers it.
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#333333" },
    requiredTags: ["{{firstName}}", "{{product_list}}"],
    changes: [
      "{{product_list}} moves into a real HTML BLOCK. It used to sit inside " +
        "<span> inside <p> - a table nested in a paragraph, which every mail " +
        "client hoists back out, taking the layout with it",
      "the centred <img> masthead becomes a LOGO block",
      "Quill's 14pt inline spans dropped in favour of the email-wide styles"
    ],
    notes: [
      "the order table itself was rebuilt in transactional-emails.ts " +
        "(buildWebProductListHtml): 4 even columns instead of 7 ragged ones, " +
        "64px thumbnails instead of 100px, totals that line up under TOTAL. " +
        "See functions/test/product-list.test.js."
    ],
    blocks: [
      {
        section: 0,
        type: "logo",
        align: "center",
        props: {
          src: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8" +
            ".appspot.com/o/Logos%2FImpact-Logo_Black.png?alt=media" +
            "&token=2a2452b7-a337-476f-b268-d0a4b0fa5d42",
          alt: "Impact Discipleship Ministries",
          sizing: "original",
          naturalWidth: 200
        }
      },
      { section: 1, type: "text", html: "<p>Dear {{firstName}},</p>" },
      {
        section: 1,
        type: "text",
        html:
          "<p><strong>Thank you for your order from Impact Discipleship " +
          "Ministries!</strong></p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>We typically ship orders on <strong>Tuesdays and Thursdays" +
          "</strong> via <strong>UPS</strong>.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>Most orders are processed and shipped promptly. However, larger " +
          "orders may require additional processing time because they are " +
          "fulfilled directly by our publisher. Please allow <strong>up to two " +
          "weeks</strong> for these orders to ship.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>If you have any questions about your order, please don't hesitate " +
          "to contact us. Thank you for partnering with us as we inspire people " +
          "and churches to <strong>Be and Build Disciples of Jesus Christ." +
          "</strong></p>"
      },
      // An HTML block, not a text block: this is a <table>, and the builder's
      // html block is the one that passes markup through untouched.
      { section: 1, type: "html", html: "{{product_list}}" },
      {
        section: 2,
        type: "text",
        html:
          "<p>Blessings,</p>" +
          "<p><strong>The Impact Ministries Team</strong></p>"
      }
    ]
  },

  "Disciple-Making Church Seminar Receipt": {
    // Shared by TEN events, two of them active and upcoming (Smiths Station
    // 2026-02-22, Awaken 2026-03-07) - which is why it names no venue or
    // date. Editing it from one event's form changes the confirmation for
    // the other nine.
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#333333" },
    requiredTags: [],
    changes: [
      "the contact link's href was the literal string \"[object Object]\" - an " +
        "object stringified into it, live on both projects - and is now " +
        "mailto:info@impactdisciples.com, which is what the link TEXT has " +
        "always said"
    ],
    notes: [
      "this template contains no merge tags at all, so it cannot greet the " +
        "registrant by name or name their event. Left as-is - adding one is a " +
        "copy decision, not a conversion."
    ],
    blocks: [
      {
        section: 1,
        type: "text",
        html:
          "<p>Thank you for registering for the <strong>Disciple-Making Church " +
          "Seminar</strong>! We’re excited to have you join us as we grow " +
          "together in becoming and building disciples of Jesus.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>If you have any questions before the event, feel free to reach " +
          "out to us at <a href=\"mailto:info@impactdisciples.com\">" +
          "info@impactdisciples.com</a>.</p>"
      },
      {
        section: 1,
        type: "text",
        html: "<p>We look forward to seeing you there!</p>"
      },
      {
        section: 2,
        type: "text",
        html:
          "<p><strong>In Christ,</strong></p>" +
          "<p>The Impact Discipleship Team</p>" +
          "<p><a href=\"https://impactdisciples.com\" rel=\"noopener noreferrer\" " +
          "target=\"_blank\">ImpactDisciples.com</a></p>"
      }
    ]
  },

  "Summit Registration 2027": {
    // Sent by register_for_event, which renders with renderEmailBody - so
    // both {{eventName}}/{{startDate}} and *|TAG|* resolve.
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#333333" },
    requiredTags: ["{{firstName}}", "{{eventName}}", "{{startDate}}"],
    changes: [
      "the summit link pointed at /summit/2026 in a template named (and used " +
        "by an event called) 2027 - now /summit/2027, which the web app's " +
        "summit/:year route serves",
      "Quill's 14pt inline spans dropped in favour of the email-wide styles",
      "the duplicated confirmation sentence removed (owner approved): it said " +
        "\"starting on {{startDate}}. Your registration for the Summit on " +
        "{{startDate}} has been confirmed.\" - the same date, twice, in one " +
        "breath"
    ],
    notes: [
      "\"We look forward to seeing you in February!\" still hardcodes a month. " +
        "Kept - it is a copy decision, and {{startDate}} already carries the " +
        "real date immediately above it."
    ],
    blocks: [
      { section: 1, type: "text", html: "<p>Dear {{firstName}},</p>" },
      {
        section: 1,
        type: "text",
        html:
          "<p>You have successfully registered for <strong>" +
          "<a href=\"https://impactdisciples.com/summit/2027\" " +
          "rel=\"noopener noreferrer\" target=\"_blank\">{{eventName}}</a></strong>, " +
          "starting on <strong>{{startDate}}</strong>.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>We're excited to have you join us for a weekend of encouragement, " +
          "practical training, and inspiration as we learn together how to " +
          "<strong>Be and Build Disciples</strong>.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p><strong>More details—including the speaker lineup, breakout " +
          "sessions, and event schedule—will be announced in the coming " +
          "months.</strong> We'll keep you updated as new information becomes " +
          "available.</p>"
      },
      {
        section: 1,
        type: "text",
        html: "<p>We look forward to seeing you in February!</p>"
      },
      {
        section: 2,
        type: "text",
        html: "<p>Blessings,</p><p><strong>Impact Discipleship Ministries</strong></p>"
      }
    ]
  },

  // Renamed from "Summit Registration Success Template" on 2026-08-27
  // (scripts/rename-template.js, which repointed its event in the same run).
  // The new name settles what the old one could not: it is the 2026 summit's
  // confirmation, so the /summit/2026 link below is correct rather than
  // suspect.
  "Summit Registration 2026": {
    globalStyles: { headingFont: "Helvetica, Arial, sans-serif", paragraphColor: "#333333" },
    requiredTags: [
      "{{firstName}}", "{{eventName}}", "{{startDate}}", "{{editRegistration}}"
    ],
    changes: [
      "the centred <img> masthead becomes a real LOGO block - same hosted " +
        "image, but sized by the builder instead of a 149.6808510638299px " +
        "width attribute",
      "Quill's 14pt inline spans dropped in favour of the email-wide styles"
    ],
    blocks: [
      {
        section: 0,
        type: "logo",
        align: "center",
        props: {
          src: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8" +
            ".appspot.com/o/Logos%2FImpact-Logo_Black.png?alt=media" +
            "&token=2a2452b7-a337-476f-b268-d0a4b0fa5d42",
          alt: "Impact Discipleship Ministries",
          sizing: "original",
          naturalWidth: 150
        }
      },
      { section: 1, type: "text", html: "<p>Dear {{firstName}},</p>" },
      {
        section: 1,
        type: "text",
        html:
          "<p>You have successfully registered for <strong>" +
          "<a href=\"https://impactdisciples.com/summit/2026\" " +
          "rel=\"noopener noreferrer\" target=\"_blank\">{{eventName}}</a></strong> " +
          "starting on {{startDate}}. We're looking forward to seeing you there!</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>To register for or update your breakout sessions, click the " +
          "<strong>Register For Breakout</strong> link below. <strong>Be sure to " +
          "keep this email</strong> - you can return to it any time to view your " +
          "selected sessions or make changes to your breakout choices.</p>"
      },
      {
        section: 1,
        type: "text",
        html:
          "<p>Use the <strong>{{editRegistration}}</strong> link to choose your " +
          "breakout sessions.</p>"
      },
      {
        section: 2,
        type: "text",
        html: "<p>Blessings,</p><p><strong>Impact Discipleship Ministries</strong></p>"
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
    if (blockSpec.props) {
      // Non-text blocks (a logo, an image) carry their own prop shape.
      Object.assign(block.props, blockSpec.props);
    } else {
      block.props.html = blockSpec.html;
      if (blockSpec.level) block.props.level = blockSpec.level;
    }
    // Blocks default to centred; flowed text is left-aligned unless the
    // original centred it (a masthead logo, typically).
    block.styles.align = blockSpec.align ?? "left";
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
  const snap = await tenantCollection(db, "mail_templates").where("name", "==", name).get();
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

  // Things wrong with the CONTENT that a conversion deliberately does not
  // touch. Printed every run so they stay visible rather than becoming
  // folklore in a commit message nobody re-reads.
  if (spec.notes?.length) {
    console.log("");
    console.log("  Left alone, but you should know:");
    spec.notes.forEach((n) => console.log(`    - ${n}`));
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
  //
  // NEVER overwritten. Re-running this after a first conversion - to correct
  // a typo in the authored blocks, say - would otherwise back up the BUILDER
  // version and call it the original, quietly turning --revert into "restore
  // the previous conversion" instead of "put the legacy template back". The
  // first backup is the only one that holds the pre-conversion document.
  const file = backupPath(name, projectId);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`\n  backup kept : ${file}`);
    console.log(`                taken ${existing.takenAt}, before the first conversion`);
    console.log("                (not overwritten - it is the only copy of the legacy template)");
  } else {
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
  }

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
