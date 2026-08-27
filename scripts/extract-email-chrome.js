#!/usr/bin/env node
// READ-ONLY: mines the archived campaign emails for the HEADER and FOOTER
// markup that actually recurs, so the email builder can offer real ones as
// starting points instead of a blank canvas.
//
// Every archived email is a Mailchimp export, but in TWO generations of their
// markup, and each needs its own reader:
//
//   classic   #templateHeader / #templateFooter, explicitly labelled
//   newer     mce* classes with no labels at all - the header is the first
//             section carrying the logo, the footer the last one carrying an
//             unsubscribe link or a postal address
//
// Grouping is by NORMALISED markup (whitespace collapsed, ids and Mailchimp's
// per-send tracking tokens stripped), because the same designed header is
// re-exported with different generated ids on every campaign - compared raw,
// 479 emails look like 479 unique headers.
//
// Only emails sent in 2025 or later are mined (owner decision 2026-08-27).
// The archive goes back to 2020, but a 2021 masthead is not a starting point
// anyone wants in 2026 - it is the old brand. `--since` moves the line.
//
//   node scripts/extract-email-chrome.js --project=prod
//   node scripts/extract-email-chrome.js --project=prod --since=2024
//   ... add --write to save the winners to scripts/output/ as JSON + a
//   contact-sheet HTML you can open and look at.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");
const { cleanChromeFragment, unresolvableTags } = require("./lib/email-chrome-clean");

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

/**
 * Finds the element that opens at `startIdx` and returns everything through
 * its matching close tag. A regex cannot do this - these are nested tables.
 * @param {string} html Full document.
 * @param {number} startIdx Index of the opening "<".
 * @return {string} The element's outer HTML, or "" if unbalanced.
 */
function sliceElement(html, startIdx) {
  const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(startIdx, startIdx + 40));
  if (!tagMatch) return "";
  const tag = tagMatch[1];
  const open = new RegExp(`<${tag}\\b`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  open.lastIndex = startIdx + 1;
  close.lastIndex = startIdx + 1;
  let depth = 1;
  let cursor = startIdx + 1;
  while (depth > 0) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return "";
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + 1;
    } else {
      depth--;
      cursor = c.index + 1;
      if (depth === 0) return html.slice(startIdx, c.index + c[0].length);
    }
  }
  return "";
}

/**
 * The element carrying `id="<name>"`, outer HTML included.
 *
 * Matches the ATTRIBUTE, not the bare word. Mailchimp emails declare
 * `#templateHeader{...}` in a <style> block near the top, so a plain
 * indexOf("templateHeader") lands in the CSS and slices from the <style>
 * element - which returns the whole document, and makes every header and
 * footer come out byte-identical.
 */
function elementWithId(html, name) {
  const idx = html.indexOf(`id="${name}"`);
  if (idx === -1) return "";
  const start = html.lastIndexOf("<", idx);
  return start === -1 ? "" : sliceElement(html, start);
}

// --------------------------------------------------------------- normalise

/**
 * Two exports of the same designed header differ only in generated ids and
 * per-send tracking tokens. Strip those so identical designs group together.
 * @param {string} html Fragment.
 * @return {string} Comparable form.
 */
function normalise(html) {
  return html
    .replace(/\s+/g, " ")
    .replace(/ (id|class)="[^"]*"/g, "")
    // Mailchimp rewrites every href per send for click tracking.
    .replace(/https?:\/\/[^"'\s>]*mailchi[^"'\s>]*/gi, "TRACKED")
    .replace(/\*\|[A-Z_]+\|\*/g, "TAG")
    .replace(/>\s+</g, "><")
    .trim()
    .toLowerCase();
}

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

// ------------------------------------------------------------- extraction

function extractClassic(html) {
  return {
    header: elementWithId(html, "templateHeader"),
    footer: elementWithId(html, "templateFooter")
  };
}

function extractModern(html) {
  // No labels in this generation. Sections are mceWrapper/mceSection blocks;
  // take the FIRST that carries an image (the masthead) and the LAST that
  // mentions unsubscribing or a postal address.
  // The class vocabulary is not consistent across the archive - of 443
  // non-classic emails, 221 carry mceWrapper, 242 mceSection, 294 mceRow and
  // 421 mceColumn - so match ANY of them rather than assuming one generation
  // wrote them all. Ordered widest-first so a section wins over a row inside
  // it; the first match at a given index is the outermost element there.
  const sections = [];
  const re = /<(?:table|td|div)[^>]*class="[^"]*(mceWrapper|mceSection|mceRow|mceColumn)[^"]*"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const el = sliceElement(html, m.index);
    if (el) sections.push(el);
    re.lastIndex = m.index + 1;
  }
  const header = sections.find((s) => /<img/i.test(s)) ?? "";
  const footerCandidates = sections.filter(
    (s) => /unsubscribe|all rights reserved|update your preferences/i.test(s)
  );
  return { header, footer: footerCandidates[footerCandidates.length - 1] ?? "" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  const sinceYear = Number(args.since ?? 2025);
  const snap = await db.collection("campaign_emails").get();
  console.log(`${projectId}: ${snap.size} archived emails`);
  console.log(`  mining sends from ${sinceYear} onward`);

  const groups = { header: new Map(), footer: new Map() };
  const pairs = new Map();
  let classic = 0; let modern = 0; let noneFound = 0;
  let tooOld = 0; let undated = 0;

  snap.forEach((doc) => {
    const data = doc.data();
    const html = String(data.html || "");
    if (!html) return;

    // sentAt is the only date these carry (478 of 479 have it). An undated
    // email is SKIPPED rather than assumed recent - one document, and
    // guessing would be the wrong direction.
    const sent = data.sentAt?.toDate?.() ?? null;
    if (!sent) { undated++; return; }
    if (sent.getFullYear() < sinceYear) { tooOld++; return; }
    const isClassic = html.includes("templateHeader");
    if (isClassic) classic++; else modern++;
    const found = isClassic ? extractClassic(html) : extractModern(html);

    // Track the PAIR as well as the parts. A starting template is a whole
    // email shell, and the header/footer that actually shipped together are
    // the ones known to look right together - pairing the most-used header
    // with the most-used footer could combine two different eras' branding.
    const pairKey = { header: null, footer: null };

    let any = false;
    for (const part of ["header", "footer"]) {
      const raw = found[part];
      // Guard both ends: a 200-char fragment is a stray cell, and a 40k one
      // is the whole email because the section boundary was not found.
      if (!raw || raw.length < 300 || raw.length > 25000) continue;
      any = true;
      const key = hash(normalise(raw));
      pairKey[part] = key;
      const bucket = groups[part];
      const existing = bucket.get(key);
      const when = sent;
      if (existing) {
        existing.count++;
        if (when && (!existing.latest || when > existing.latest)) {
          existing.latest = when;
          existing.html = raw;
          existing.subject = data.subject ?? "";
        }
      } else {
        bucket.set(key, {
          key, count: 1, html: raw, latest: when, subject: data.subject ?? ""
        });
      }
    }
    if (!any) noneFound++;

    // Only a complete shell is a usable starting point - a pair missing one
    // half would drop the user into a half-branded email.
    if (pairKey.header && pairKey.footer) {
      const pk = `${pairKey.header}:${pairKey.footer}`;
      const seen = pairs.get(pk);
      if (seen) {
        seen.count++;
        if (sent > seen.latest) { seen.latest = sent; seen.subject = data.subject ?? ""; }
      } else {
        pairs.set(pk, {
          headerKey: pairKey.header, footerKey: pairKey.footer,
          count: 1, latest: sent, subject: data.subject ?? ""
        });
      }
    }
  });

  console.log(`  skipped: ${tooOld} sent before ${sinceYear}, ${undated} undated`);
  console.log(`  mined: ${classic} classic markup, ${modern} newer markup`);
  console.log(`  emails yielding neither a header nor a footer: ${noneFound}`);

  const report = {};
  for (const part of ["header", "footer"]) {
    const all = [...groups[part].values()].sort((a, b) => b.count - a.count);
    // "Recurs" means used more than once. A one-off is a bespoke design for
    // one send, not a house style worth offering as a starting point.
    const recurring = all.filter((g) => g.count > 1);
    report[part] = recurring;
    console.log("");
    console.log(`  ${part.toUpperCase()}: ${all.length} distinct, ${recurring.length} used more than once`);
    recurring.slice(0, 10).forEach((g, i) => {
      const seen = g.latest ? g.latest.toISOString().slice(0, 10) : "?";
      console.log(`    ${String(i + 1).padStart(2)}. used ${String(g.count).padStart(3)}x  last ${seen}  ${g.html.length} chars`);
      console.log(`        latest subject: ${g.subject.slice(0, 64)}`);
    });
  }

  // The shells worth offering: a header+footer that shipped together more
  // than once. Capped, because each carries its markup into the designer's
  // lazy chunk and a long tail of near-identical shells is not a gallery,
  // it is a wall.
  const MAX_SHELLS = 5;
  const shells = [...pairs.values()]
    .filter((p) => p.count > 1)
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .slice(0, MAX_SHELLS)
    .map((p, i) => ({
      id: `archive-shell-${i + 1}`,
      name: `Newsletter shell ${i + 1}`,
      description: `Used ${p.count}x, last ${p.latest.toISOString().slice(0, 10)} - "${p.subject.slice(0, 48)}"`,
      uses: p.count,
      lastSent: p.latest.toISOString().slice(0, 10),
      // Mined markup is Mailchimp's, and it is not safe to drop into an
      // arbitrary design as-is - see lib/email-chrome-clean.js. Cleaned HERE
      // rather than in the app so the fragment that ships is the fragment
      // that was reviewed in the diff.
      header: cleanChromeFragment(groups.header.get(p.headerKey).html),
      footer: cleanChromeFragment(groups.footer.get(p.footerKey).html)
    }));

  // A tag nothing can resolve prints raw in a customer's inbox, so refuse to
  // write rather than emit one. This catches a Mailchimp tag the archive
  // starts carrying that the transform has never seen.
  const offenders = shells.flatMap((s) => [
    ...unresolvableTags(s.header).map((t) => `${s.id} header ${t}`),
    ...unresolvableTags(s.footer).map((t) => `${s.id} footer ${t}`)
  ]);
  if (offenders.length) {
    throw new Error(
      "unresolvable merge tags survived the chrome cleanup:\n    " +
      offenders.join("\n    ") +
      "\n  Add a rule to scripts/lib/email-chrome-clean.js before writing."
    );
  }

  console.log("");
  console.log(`  SHELLS (header+footer that shipped together, used >1x): ${shells.length}`);
  shells.forEach((s) => console.log(
    `    ${s.id}  ${s.uses}x  last ${s.lastSent}  ` +
    `${(s.header.length + s.footer.length / 1).toLocaleString()} chars`));

  if (!args.write) {
    console.log("");
    console.log("  Read-only. Pass --write to save the recurring ones for review.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `email-chrome-${projectId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  // A contact sheet: every candidate rendered, biggest first, so a human can
  // pick by eye rather than by reading markup.
  const card = (g, part, i) =>
    `<section style="margin:0 0 40px;border:1px solid #ddd;">` +
    `<div style="padding:8px 12px;background:#f3f4f6;font:600 13px system-ui;">` +
    `${part} #${i + 1} &middot; used ${g.count}x &middot; last ${g.latest ? g.latest.toISOString().slice(0, 10) : "?"}` +
    `</div><div style="padding:12px;">${g.html}</div></section>`;
  const sheet =
    `<div style="max-width:900px;margin:24px auto;font:14px system-ui;">` +
    `<h1>Recurring email chrome &mdash; ${projectId}</h1>` +
    `<h2>Headers</h2>${report.header.map((g, i) => card(g, "header", i)).join("")}` +
    `<h2>Footers</h2>${report.footer.map((g, i) => card(g, "footer", i)).join("")}</div>`;
  const sheetPath = path.join(OUT_DIR, `email-chrome-${projectId}.html`);
  fs.writeFileSync(sheetPath, sheet, "utf8");

  // The generated module the designer actually reads. Committed to git on
  // purpose rather than fetched at runtime: it is derived once from a fixed
  // archive, it is reviewable in a diff, and it needs no collection, no
  // security rule and no extra read. JSON.stringify does the escaping - these
  // fragments contain backticks and ${ sequences that a template literal
  // would happily interpret.
  const tsPath = path.join(
    __dirname, "..", "src", "app", "common", "utils", "email", "archive-shells.ts"
  );
  const ts =
    `// GENERATED by scripts/extract-email-chrome.js - do not edit by hand.\n` +
    `//\n` +
    `// Header/footer shells mined from the ${projectId} campaign archive\n` +
    `// (sends from ${sinceYear} onward). Each pair actually shipped together,\n` +
    `// more than once - pairing the most-used header with the most-used footer\n` +
    `// separately could combine two different eras' branding.\n` +
    `//\n` +
    `// Every fragment has been through scripts/lib/email-chrome-clean.js: Mailchimp\n` +
    `// system tags resolved or removed (nothing here resolves them, so they printed\n` +
    `// raw in the inbox) and the loose <td> wrapped in a row. Read that file before\n` +
    `// editing a fragment by hand.\n` +
    `//\n` +
    `// Regenerate with:\n` +
    `//   node scripts/extract-email-chrome.js --project=prod --write\n` +
    `// which re-mines PROD and may return five DIFFERENT shells - the archive has\n` +
    `// moved on since these were picked.\n` +
    `\n` +
    `export interface ArchiveShell {\n` +
    `  id: string;\n` +
    `  name: string;\n` +
    `  description: string;\n` +
    `  header: string;\n` +
    `  footer: string;\n` +
    `}\n\n` +
    `export const ARCHIVE_SHELLS: ArchiveShell[] = ${JSON.stringify(
      shells.map(({ id, name, description, header, footer }) =>
        ({ id, name, description, header, footer })), null, 2
    )};\n`;
  fs.writeFileSync(tsPath, ts, "utf8");

  console.log("");
  console.log(`  wrote ${jsonPath}`);
  console.log(`  wrote ${sheetPath}  <- open this`);
  console.log(`  wrote ${tsPath}`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
