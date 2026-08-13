#!/usr/bin/env node
// One-time backfill for the "customers" collection - applies the exact same
// logic as functions/src/customer-upsert.functions.ts's
// onPurchaseCustomerUpsert trigger to every EXISTING purchase, oldest first,
// so history plays out the way it would have if the trigger had existed
// since day one: a customer's earliest purchase creates their record, every
// later purchase either fills in a gap, confirms what's on file, or (for a
// genuine, normalized-non-matching disagreement) queues a
// PendingCustomerChange (see customer.model.ts) - never silently
// overwrites a real difference. See that Cloud Function's own header
// comment for the full field-by-field rules; this is a separate, plain-JS
// mirror of the exact same rules (Cloud Functions and scripts/ run in
// different toolchains, there's no single module both could import) - keep
// the two in sync if this ever changes.
//
// Unlike the live trigger (one purchase -> one Firestore round trip), this
// walks every purchase against an in-memory map keyed by lowercased email,
// then writes each customer once at the end - matches the trigger's END
// STATE exactly without one write per historical purchase.
//
// Dry-run by default - reports counts and a handful of sample flags/
// duplicates without writing anything. Pass --execute to actually write.
// --project=dev|prod is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/backfill-customers-from-purchases.js --project=dev
//   node scripts/backfill-customers-from-purchases.js --project=dev --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

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

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function hasPhysicalItem(cartItems) {
  if (!Array.isArray(cartItems)) return false;
  return cartItems.some((item) => !item.isEBook && !item.isDigitalBook && !item.isEvent);
}

// Trim + lowercase + diacritics stripped - "Rick" vs "RICK", a stray
// trailing space, or "Hernandez" vs "Hernández" isn't a real disagreement.
// Only used as a comparison key; the raw value is always what actually
// gets stored. NFD decomposes an accented character into base + combining
// diacritical mark(s); \p{Diacritic} then strips just those marks.
function normalizedName(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().normalize("NFD");
  return normalized.replace(/\p{Diacritic}/gu, "");
}

// Digits-only, with a leading US country-code "1" stripped either way -
// "1 678.223.5312", "(678) 223-5312", and "6782235312" all normalize to the
// same 10 digits.
function normalizedPhoneDigits(value) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

// Deliberately loose "is this even shaped like an email" check - not full
// RFC validation, just enough to reject obvious garbage (a bare "x") before
// it creates a customer record. Live-diagnosed 2026-08-13: a purchase with
// email "x" created a customer doc keyed on that non-email.
function isPlausibleEmail(rawValue) {
  if (typeof rawValue !== "string") return false;
  const value = rawValue.trim();
  const at = value.indexOf("@");
  return at > 0 && at < value.length - 1 && value.includes(".", at);
}

function addressesDiffer(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  const fields = ["address1", "address2", "city", "state", "zip", "country"];
  return fields.some((f) => normalizedName(a[f]) !== normalizedName(b[f]));
}

function formatAddress(a) {
  if (!a) return "(none)";
  return [a.address1, a.address2, [a.city, a.state, a.zip].filter(Boolean).join(", "), a.country].filter(Boolean).join(", ") || "(none)";
}

function formatPhone(p) {
  if (!p || !p.number) return "(none)";
  return [p.countryCode, p.number].filter(Boolean).join(" ");
}

function formatValue(field, value) {
  if (field === "shippingAddress" || field === "billingAddress") return formatAddress(value);
  if (field === "phone") return formatPhone(value);
  return value || "(none)";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  // ---- Load existing customers, detect duplicate emails up front ----
  const existingSnap = await db.collection("customers").get();
  const byEmail = new Map();
  const duplicateEmails = new Map(); // email -> extra doc ids not kept

  existingSnap.docs.forEach((doc) => {
    const data = doc.data();
    const email = (data.email || "").trim().toLowerCase();
    if (!email) return;
    if (byEmail.has(email)) {
      const list = duplicateEmails.get(email) || [byEmail.get(email).__id];
      list.push(doc.id);
      duplicateEmails.set(email, list);
      // Keep whichever doc has more info (a pendingChanges array or an
      // address) rather than an arbitrary "last wins" - doesn't matter much
      // for a dry-run report, but matters if this ever runs with --execute.
      const current = byEmail.get(email);
      const currentScore = (current.shippingAddress ? 1 : 0) + (current.pendingChanges?.length || 0);
      const newScore = (data.shippingAddress ? 1 : 0) + (data.pendingChanges?.length || 0);
      if (newScore <= currentScore) return;
    }
    byEmail.set(email, { ...data, __id: doc.id, __existed: true });
  });

  if (duplicateEmails.size > 0) {
    console.log(`⚠ ${duplicateEmails.size} email(s) already have MORE THAN ONE customer record in Firestore:`);
    for (const [email, ids] of duplicateEmails) {
      console.log(`  ${email}: ${ids.join(", ")} (kept ${byEmail.get(email).__id}, others ignored by this script)`);
    }
    console.log("  These need manual cleanup separately - this script does not merge/delete duplicates.\n");
  }

  // ---- Load purchases, oldest first ----
  const purchasesSnap = await db.collection("purchases").get();
  const allPurchases = purchasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const purchases = allPurchases
    .filter((p) => isPlausibleEmail(p.email))
    .sort((a, b) => toMillis(a.dateProcessed) - toMillis(b.dateProcessed));

  const skippedNoEmail = allPurchases.length - purchases.length;
  console.log(`${allPurchases.length} total purchases (${skippedNoEmail} skipped - no email), processing ${purchases.length} oldest-first\n`);

  let created = 0;
  let filledCount = 0;
  const filledFieldCounts = { firstName: 0, lastName: 0, phone: 0, shippingAddress: 0, billingAddress: 0 };
  const fieldFlagCounts = { firstName: 0, lastName: 0, phone: 0, shippingAddress: 0, billingAddress: 0 };
  const sampleFlags = [];
  const sampleFills = [];

  for (const purchase of purchases) {
    const email = purchase.email.trim().toLowerCase();
    const isPhysical = hasPhysicalItem(purchase.cartItems);
    const proposedShipping = isPhysical ? purchase.shippingAddress : undefined;
    const proposedBilling = isPhysical
      ? (purchase.isShippingSameAsBilling ? purchase.shippingAddress : purchase.billingAddress)
      : undefined;

    let customer = byEmail.get(email);
    if (!customer) {
      customer = {
        firstName: purchase.firstName || "",
        lastName: purchase.lastName || "",
        email,
        phone: purchase.phone,
        shippingAddress: proposedShipping,
        billingAddress: proposedBilling,
        role: "Customer",
        notes: [],
        pendingChanges: [],
        __new: true
      };
      byEmail.set(email, customer);
      created++;
      continue;
    }

    customer.pendingChanges = customer.pendingChanges || [];

    const flagChange = (field, currentValue, proposedValue) => {
      const entry = { field, currentValue: currentValue ?? null, proposedValue, source: "purchase", sourceId: purchase.id, detectedDate: purchase.dateProcessed || null };
      const idx = customer.pendingChanges.findIndex((p) => p.field === field);
      if (idx >= 0) customer.pendingChanges[idx] = entry;
      else customer.pendingChanges.push(entry);
      customer.__dirty = true;
      fieldFlagCounts[field]++;
      if (sampleFlags.length < 15) {
        sampleFlags.push({ email, field, current: formatValue(field, currentValue), proposed: formatValue(field, proposedValue) });
      }
    };

    const fillField = (field, value) => {
      // Mutates the in-memory customer directly (not just queued for the
      // final write) - matches the live trigger's semantics, where the
      // NEXT purchase reads this field back already filled in, not still
      // empty. See __dirty handling below for how this reaches Firestore.
      customer[field] = value;
      customer.__dirty = true;
      filledCount++;
      filledFieldCounts[field]++;
      if (sampleFills.length < 10) {
        sampleFills.push({ email, field, filled: formatValue(field, value) });
      }
    };

    const resolveNameField = (field, proposedRaw) => {
      const proposed = typeof proposedRaw === "string" ? proposedRaw.trim() : "";
      if (!proposed) return;
      const currentValue = customer[field];
      if (!normalizedName(currentValue)) {
        fillField(field, proposed);
        return;
      }
      if (normalizedName(currentValue) === normalizedName(proposed)) return;
      flagChange(field, currentValue, proposed);
    };

    const resolvePhoneField = (proposed) => {
      // Not real phone data (missing, or garbage like "x"/"Y" that strips
      // to zero digits) - nothing worth filling or flagging with. Without
      // this, a junk value normalizes to "" same as "nothing on file", so
      // a blank field gets "filled" with the same junk forever, never
      // converging (live-diagnosed 2026-08-13 - see the matching comment
      // in customer-upsert.functions.ts).
      const proposedDigits = normalizedPhoneDigits(proposed?.number);
      if (!proposedDigits) return;
      const currentValue = customer.phone;
      const currentDigits = normalizedPhoneDigits(currentValue?.number);
      if (!currentDigits) {
        fillField("phone", proposed);
        return;
      }
      if (currentDigits === proposedDigits) return;
      flagChange("phone", currentValue, proposed);
    };

    const resolveAddressField = (field, proposed) => {
      if (!proposed?.address1) return;
      const currentValue = customer[field];
      if (!currentValue?.address1) {
        fillField(field, proposed);
        return;
      }
      if (!addressesDiffer(currentValue, proposed)) return;
      flagChange(field, currentValue, proposed);
    };

    resolveNameField("firstName", purchase.firstName);
    resolveNameField("lastName", purchase.lastName);
    resolvePhoneField(purchase.phone);
    resolveAddressField("shippingAddress", proposedShipping);
    resolveAddressField("billingAddress", proposedBilling);
  }

  const dirtyExisting = [...byEmail.values()].filter((c) => c.__existed && c.__dirty);
  const totalFlags = Object.values(fieldFlagCounts).reduce((a, b) => a + b, 0);

  console.log(`${existingSnap.size} customers currently in Firestore (${duplicateEmails.size} duplicate email(s) noted above)`);
  console.log(`${created} NEW customer record(s) would be created`);
  console.log(`${filledCount} gap(s) would be silently filled in (field was empty, purchase had a value - not a conflict):`);
  for (const [field, count] of Object.entries(filledFieldCounts)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }
  console.log(`${dirtyExisting.length} EXISTING customer(s) would get pending-review flags (${totalFlags} total field flags):`);
  for (const [field, count] of Object.entries(fieldFlagCounts)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }
  console.log("");

  if (sampleFills.length > 0) {
    console.log(`Sample fills (first ${sampleFills.length}):`);
    for (const s of sampleFills) {
      console.log(`  [${s.email}] ${s.field}: (none) -> "${s.filled}"`);
    }
    console.log("");
  }

  if (sampleFlags.length > 0) {
    console.log(`Sample flags (first ${sampleFlags.length}):`);
    for (const s of sampleFlags) {
      console.log(`  [${s.email}] ${s.field}: "${s.current}" -> "${s.proposed}"`);
    }
    console.log("");
  }

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  // ---- Write: batched, 400 ops/batch to stay well under the 500 limit ----
  const toWrite = [...byEmail.values()].filter((c) => c.__new || c.__dirty);
  console.log(`Writing ${toWrite.length} customer record(s)...`);

  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  for (const c of toWrite) {
    const clean = { ...c };
    delete clean.__id;
    delete clean.__existed;
    delete clean.__new;
    delete clean.__dirty;

    if (c.__new) {
      const ref = db.collection("customers").doc();
      batch.set(ref, clean);
    } else {
      const ref = db.collection("customers").doc(c.__id);
      // Full field set (not just pendingChanges) - fillField() above may
      // have mutated firstName/lastName/phone/shippingAddress/
      // billingAddress in-memory too.
      batch.update(ref, {
        firstName: clean.firstName,
        lastName: clean.lastName,
        phone: clean.phone,
        shippingAddress: clean.shippingAddress,
        billingAddress: clean.billingAddress,
        pendingChanges: clean.pendingChanges
      });
    }

    opsInBatch++;
    if (opsInBatch >= 400) {
      await batch.commit();
      batchesFlushed++;
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) {
    await batch.commit();
    batchesFlushed++;
  }

  console.log(`Done - ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
