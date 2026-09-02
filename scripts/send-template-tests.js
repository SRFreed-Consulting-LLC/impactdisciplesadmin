#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Sends a test copy of every mail_template to one address, rendered with
// realistic sample data, so the whole set can be looked at in a real inbox
// rather than in a preview pane.
//
// Each send goes through the SAME renderer the real path uses
// (renderEmailBody) and the SAME queue (the `mail` collection, picked up by
// the Trigger Email extension), so what arrives is what a customer would get -
// not an approximation.
//
// Every subject is prefixed [TEST] on purpose. These land in a real inbox
// beside real mail, and a receipt that cannot be told from a receipt is a
// support ticket waiting to happen.
//
//   node scripts/send-template-tests.js --project=dev --to=someone@example.com
//   ... add --execute to actually queue. Dry run prints what WOULD be sent.
//
// Defaults to dev. Sending prod copies of these is not obviously wrong, but it
// writes to the prod `mail` collection and shows up in Sent Emails, so it has
// to be asked for explicitly.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { resolveProjectId, getFirestoreFor, firestore } = require("./lib/firestore-admin");

const OUT_DIR = path.join(__dirname, "output");

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

// The sample values each KIND's send path actually supplies. A template is
// rendered with its own kind's model and nothing else - feeding every value
// to every template would hide exactly the bug this is meant to surface,
// which is a tag the real path cannot resolve.
function modelFor(kind, productList) {
  const person = {
    firstName: "Shane",
    lastName: "Freed",
    email: "shane.freed@gmail.com",
  };
  switch (kind) {
    case "event":
    case "summit":
      return {
        ...person,
        eventName: "Disciple-Making Church Seminar",
        startDate: "March 7, 2026 at 9:00 AM",
        editRegistration:
          "<a href=\"https://impactdisciples.com/events/sample/registrations/sample\">" +
          "Register for Breakout</a>",
      };
    case "store":
      return { ...person, product_list: productList };
    case "fulfillment":
      return {
        ...person,
        date: new Date().toLocaleDateString("en-US"),
        tracking: "Tracking: 1Z999AA10123456784",
      };
    case "product":
    default:
      return person;
  }
}

function loadModules() {
  const root = path.join(__dirname, "..", "src", "app", "common");
  const entry = path.join(os.tmpdir(), `tpl-test-entry-${process.pid}.ts`);
  const imp = (p) => JSON.stringify(p.split(path.sep).join("/"));
  fs.writeFileSync(entry,
    `export * from ${imp(path.join(root, "utils", "email", "merge-tags"))};\n`, "utf8");
  try {
    const built = esbuild.buildSync({
      entryPoints: [entry], bundle: true, format: "cjs",
      platform: "node", target: "node18", write: false, logLevel: "silent"
    });
    const out = path.join(os.tmpdir(), `tpl-test-bundle-${process.pid}.js`);
    fs.writeFileSync(out, built.outputFiles[0].text, "utf8");
    try {
      return require(out);
    } finally {
      fs.unlinkSync(out);
    }
  } finally {
    fs.unlinkSync(entry);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project ?? "dev");
  const to = args.to;
  const execute = args.execute === true;
  if (!to || !to.includes("@")) throw new Error('Pass --to=<email address>');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);
  const { renderEmailBody } = loadModules();

  // The order table the store receipt interpolates. Built here rather than
  // imported from functions/ so this script needs no compiled output; the
  // shape mirrors buildWebProductListHtml.
  const productList =
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" " +
    "border=\"0\" style=\"width:100%;border-collapse:collapse;\">" +
    "<tr><th colspan=\"2\" style=\"text-align:left;font-size:11px;color:#6a7280;\">PRODUCT</th>" +
    "<th style=\"text-align:center;font-size:11px;color:#6a7280;\">QTY</th>" +
    "<th style=\"text-align:right;font-size:11px;color:#6a7280;\">TOTAL</th></tr>" +
    "<tr><td style=\"width:72px;\"></td>" +
    "<td style=\"padding:10px 8px;border-bottom:1px solid #e5e7eb;\">Disciple-Making Field Guide" +
    "<div style=\"font-size:12px;color:#6a7280;\">$20.00 each</div></td>" +
    "<td style=\"text-align:center;padding:10px 8px;border-bottom:1px solid #e5e7eb;\">2</td>" +
    "<td style=\"text-align:right;padding:10px 8px;border-bottom:1px solid #e5e7eb;\">$40.00</td></tr>" +
    "<tr><td colspan=\"3\" style=\"text-align:right;padding:6px 8px;\"><b>TOTAL</b></td>" +
    "<td style=\"text-align:right;padding:6px 8px;\"><b>$48.50</b></td></tr></table>" +
    "<div style=\"margin-top:12px;font-size:13px;color:#6a7280;\">" +
    "Confirmation Id: <b>IMP-TEST-0001</b></div>";

  const snap = await tenantCollection(db, "mail_templates").get();
  const templates = [];
  snap.forEach((d) => {
    const t = d.data();
    if (t.kind === "campaign") return; // campaign gallery, not a send path
    templates.push({ id: d.id, ...t });
  });
  templates.sort((a, b) => String(a.kind).localeCompare(String(b.kind)));

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  to: ${to}`);
  console.log(`  templates: ${templates.length}`);
  console.log("");

  const sent = [];
  const skipped = [];

  for (const t of templates) {
    const kind = t.kind ?? "system";
    const model = modelFor(kind, productList);

    if (!t.html || !String(t.html).trim()) {
      skipped.push({ name: t.name, why: "no html stored" });
      continue;
    }

    const html = renderEmailBody(String(t.html), model);
    const subject = "[TEST] " + renderEmailBody(String(t.subject || t.name), {
      ...model, product_list: undefined
    });

    // What did NOT resolve. A tag left standing is the interesting result -
    // it means this template names something its own send path never supplies.
    const leftover = [...new Set([
      ...(html.match(/\*\|[A-Z_]+\|\*/g) || []),
      ...(html.match(/\{\{[^}]{1,40}\}\}/g) || [])
    ])];

    console.log(`  ${kind.padEnd(12)} ${t.name}`);
    console.log(`     subject: ${subject.slice(0, 72)}`);
    if (leftover.length) {
      console.log(`     UNRESOLVED: ${leftover.join(" ")}`);
    }

    if (execute) {
      await db.collection("mail").add({
        to,
        date: firestore.Timestamp.now(),
        message: { subject, html },
      });
    }
    sent.push({ name: t.name, kind, subject, leftover });
  }

  console.log("");
  if (skipped.length) {
    console.log(`  NOT SENT (${skipped.length}):`);
    skipped.forEach((s) => console.log(`     ${s.name} - ${s.why}`));
  }
  const withLeftovers = sent.filter((s) => s.leftover.length);
  if (withLeftovers.length) {
    console.log(`  sent, but with unresolved tags (${withLeftovers.length}):`);
    withLeftovers.forEach((s) => console.log(`     ${s.name}: ${s.leftover.join(" ")}`));
  }

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing queued. Re-run with --execute.");
    return;
  }
  console.log(`  queued ${sent.length} email(s) to ${to}.`);
  console.log("  The Trigger Email extension picks them up from `mail` within a minute or so.");
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
