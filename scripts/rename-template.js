#!/usr/bin/env node
// Renames a mail_template AND repoints everything bound to the old name, in
// that order.
//
// This is the single most dangerous edit in this collection, which is why it
// is a script and not a text field. An event stores its confirmation as a
// NAME (`emailTemplate: "Summit Registration Success Template"`), and the
// send path looks the template up by that string. Rename the template on its
// own and every event still names the old one: register_for_event finds
// nothing and the registrant receives NO email, with no error anywhere.
// Renaming looks completely harmless at the moment you do it.
//
//   node scripts/rename-template.js --project=dev \
//     --from="Summit Registration Success Template" --to="Summit Registration 2026"
//   ... add --execute to write.
//
// REFUSES for names a send path hardcodes - see CODE_CRITICAL below.
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const OUT_DIR = path.join(__dirname, "output");

// Templates the CODE owns. Since 2026-08-27 these are resolved by PINNED
// DOCUMENT ID rather than by name (scripts/pin-template-ids.js), which is
// exactly what makes renaming them safe now - so this list is no longer a
// refusal, just a note printed alongside the rename.
const CODE_OWNED_IDS = new Set([
  "tmpl-sales-receipt",
  "tmpl-amazon-shipping-confirmation"
]);

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

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const from = args.from;
  const to = args.to;

  if (!from || !to) throw new Error('Pass --from="<old name>" --to="<new name>"');
  if (from === to) throw new Error("--from and --to are the same.");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);

  const snap = await db.collection("mail_templates").where("name", "==", from).get();
  if (snap.empty) throw new Error(`No template named "${from}" on ${projectId}.`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${from}".`);

  // A duplicate name is worse than a bad one: every lookup then has to guess.
  const clash = await db.collection("mail_templates").where("name", "==", to).get();
  if (!clash.empty) {
    throw new Error(`A template named "${to}" already exists (${clash.docs[0].id}).`);
  }

  const doc = snap.docs[0];
  const events = await db.collection("events").get();
  const bound = [];
  events.forEach((d) => {
    if (d.data().emailTemplate === from) {
      bound.push({
        id: d.id,
        name: d.data().eventName ?? "(untitled)",
        active: d.data().isActive !== false
      });
    }
  });

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  rename   : "${from}"`);
  console.log(`        to : "${to}"`);
  console.log(`  doc id   : ${doc.id}  (kind ${doc.data().kind ?? "system"})`);
  if (CODE_OWNED_IDS.has(doc.id)) {
    console.log("  note     : a send path resolves this by its ID, not its " +
      "name - renaming it is safe.");
  }
  console.log(`  events bound by the OLD name: ${bound.length}`);
  bound.forEach((e) => console.log(`      ${e.active ? "[ACTIVE]  " : "[inactive]"} ${e.name}`));

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  const backup = path.join(OUT_DIR, `template-rename-${slug(from)}-${projectId}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    project: projectId, renamedAt: new Date().toISOString(),
    id: doc.id, from, to, events: bound
  }, null, 2), "utf8");
  console.log("");
  console.log(`  backed up to: ${backup}`);

  // Events FIRST. Between these two writes a lookup of the old name still
  // succeeds, so the window is "events point at a name that does not exist
  // YET" rather than "at one that no longer exists" - and the second write
  // closes it. The reverse order would leave a real gap where a registration
  // silently sends nothing.
  for (const e of bound) {
    await db.collection("events").doc(e.id).update({ emailTemplate: to });
  }
  if (bound.length) console.log(`  repointed ${bound.length} event(s)`);

  await doc.ref.update({ name: to });
  console.log(`  renamed. now: "${(await doc.ref.get()).data().name}"`);

  // Prove it: nothing may be left naming a template that does not exist.
  const after = await db.collection("mail_templates").get();
  const names = new Set();
  after.forEach((d) => names.add(d.data().name));
  const dangling = [];
  (await db.collection("events").get()).forEach((d) => {
    const n = d.data().emailTemplate;
    if (n && !names.has(n)) dangling.push(`${d.data().eventName ?? d.id} -> ${n}`);
  });
  console.log(`  events naming a missing template: ${dangling.length}`);
  dangling.forEach((x) => console.log(`      ${x}`));
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
