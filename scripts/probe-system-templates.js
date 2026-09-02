#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// READ-ONLY census of every mail_template still sitting in the System
// Templates list, with the two facts that decide whether it can move:
//
//   1. Does a screen already OWN it - an event's emailTemplate, a product's
//      followUpEmailId, the store's receipt? A template cannot leave the
//      list until there is somewhere else to edit it.
//   2. How big is the doc? Converting to a builder template ADDS a `design`
//      alongside a recompiled `html`, so a doc near Firestore's 1 MiB
//      per-document limit cannot be converted without shrinking first.
//
//   node scripts/probe-system-templates.js --project=dev
"use strict";

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const FIRESTORE_DOC_LIMIT = 1048576; // 1 MiB

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

// Rough doc size: JSON byte length of the data. Not Firestore's exact
// accounting (which counts field names and index entries too), so treat it
// as a floor, not a budget.
function approxSize(data) {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

const pct = (n) => ((n / FIRESTORE_DOC_LIMIT) * 100).toFixed(1) + "%";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  const [templates, events, products] = await Promise.all([
    db.collection("mail_templates").get(),
    tenantCollection(db, "events").get(),
    tenantCollection(db, "products").get()
  ]);

  // Who points at what. Events bind BY NAME (emailTemplate), products bind
  // BY DOC ID (followUpEmailId) - the two addressing schemes the editor
  // service already mirrors.
  const eventsByTemplateName = new Map();
  events.forEach((d) => {
    const name = d.data().emailTemplate;
    if (!name) return;
    if (!eventsByTemplateName.has(name)) eventsByTemplateName.set(name, []);
    eventsByTemplateName.get(name).push({
      id: d.id,
      title: d.data().eventName ?? "(untitled)",
      active: d.data().isActive !== false
    });
  });

  const productsByTemplateId = new Map();
  products.forEach((d) => {
    const id = d.data().followUpEmailId;
    if (!id) return;
    if (!productsByTemplateId.has(id)) productsByTemplateId.set(id, []);
    productsByTemplateId.get(id).push({ id: d.id, name: d.data().title ?? "(unnamed)" });
  });

  const rows = [];
  templates.forEach((d) => {
    const t = d.data();
    const kind = t.kind ?? "(absent -> system)";
    if (kind === "campaign") return; // campaign gallery, not this list
    const size = approxSize(t);
    rows.push({
      id: d.id,
      name: t.name ?? "(unnamed)",
      kind,
      size,
      htmlLen: String(t.html ?? "").length,
      hasDesign: !!t.design,
      events: eventsByTemplateName.get(t.name) ?? [],
      products: productsByTemplateId.get(d.id) ?? []
    });
  });

  rows.sort((a, b) => b.size - a.size);

  console.log(`${projectId}: ${rows.length} template(s) outside the campaign gallery\n`);

  for (const r of rows) {
    // Converting roughly doubles the payload: the design tree plus the
    // compiled html it renders to, both stored on the same doc.
    const tooBig = !r.hasDesign && r.size * 2 > FIRESTORE_DOC_LIMIT;
    console.log(`${r.name}`);
    console.log(`  id     : ${r.id}`);
    console.log(`  kind   : ${r.kind}${r.hasDesign ? "   [BUILDER]" : "   [legacy rich text]"}`);
    console.log(`  size   : ${r.size.toLocaleString()} bytes  (${pct(r.size)} of the 1 MiB doc limit)`);
    if (tooBig) {
      console.log(`  !! CANNOT CONVERT: design + recompiled html would not fit in one document.`);
    }
    if (r.events.length) {
      const live = r.events.filter((e) => e.active).length;
      console.log(`  owner  : ${r.events.length} event(s), ${live} active -> editable from the event form`);
      r.events.forEach((e) => console.log(`             ${e.active ? "[active]  " : "[inactive]"} ${e.title}`));
    } else if (r.products.length) {
      console.log(`  owner  : ${r.products.length} product(s) -> editable from the product form`);
      r.products.forEach((p) => console.log(`             ${p.name}`));
    } else {
      console.log(`  owner  : NONE FOUND - nothing references this template`);
    }
    console.log("");
  }

  const orphans = rows.filter((r) => !r.events.length && !r.products.length);
  console.log(`unreferenced: ${orphans.length}  (${orphans.map((r) => r.name).join(", ") || "none"})`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
