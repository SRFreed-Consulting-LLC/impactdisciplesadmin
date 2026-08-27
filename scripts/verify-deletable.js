#!/usr/bin/env node
// READ-ONLY cross-check of the deletion set, done WITHOUT relying on an `in`
// query: loads every purchase and registration email, lowercases both sides,
// and intersects. A case mismatch in an `in` query fails silently and would
// mean deleting somebody who actually bought something.
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const blank = (v) => typeof v !== "string" || v.trim() === "";
const norm = (v) => String(v ?? "").trim().toLowerCase();

(async () => {
  const db = getFirestoreFor(resolveProjectId(process.argv[2]));

  const buyers = new Set();
  const attendees = new Set();
  let mixedCase = 0;
  for (const [coll, target] of [["purchases", buyers], ["event-registrations", attendees]]) {
    const snap = await db.collection(coll).get();
    snap.forEach((d) => {
      const raw = d.data().email;
      if (!raw) return;
      if (String(raw) !== norm(raw)) mixedCase++;
      target.add(norm(raw));
    });
    console.log(`  ${coll}: ${snap.size} docs, ${target.size} distinct emails`);
  }
  console.log(`  emails stored with upper-case characters: ${mixedCase}`);

  const snap = await db.collection("customers").get();
  const noLast = [];
  snap.forEach((d) => { const c = d.data(); if (blank(c.lastName)) noLast.push({ id: d.id, ...c }); });

  const keep = [];
  const del = [];
  for (const c of noLast) {
    const e = norm(c.email);
    if (buyers.has(e) || attendees.has(e)) keep.push({ ...c, why: buyers.has(e) ? "purchase" : "event" });
    else del.push(c);
  }

  console.log("");
  console.log(`  customers with no lastName ....... ${noLast.length}`);
  console.log(`  KEEP (bought or attended) ........ ${keep.length}`);
  keep.forEach((c) => console.log(`      ${c.email}  (${c.why})`));
  console.log(`  DELETE ........................... ${del.length}`);
  console.log(`  no email address at all .......... ${del.filter((c) => blank(c.email)).length}`);
  console.log("");
  console.log("  first 12 to be deleted:");
  del.slice(0, 12).forEach((c) => console.log(`      ${String(c.email).padEnd(42)} ${c.firstName ? "firstName=" + c.firstName : ""}`));
})().catch((e) => { console.error(e); process.exit(1); });
