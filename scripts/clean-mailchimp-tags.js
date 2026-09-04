// Removes the dead Mailchimp system tags from the imported campaign emails.
//
//   node scripts/clean-mailchimp-tags.js --project=dev|prod [--execute]
//   node scripts/clean-mailchimp-tags.js --project=prod --backup=path.json --execute
//
// DRY RUN unless --execute.
//
// WHY THEY PRINT AT ALL. Mailchimp was retired 2026-08-20 and nothing
// resolves its tags; renderMergeTags deliberately leaves an unknown tag
// EXACTLY as written ("a literal *|SOMETHING|* in an email is a visible bug
// someone reports, where silently deleting it is not"). So a staff member
// sending a test on 2026-09-04 got a footer reading
//
//   Copyright (C) 2026 *|LIST:COMPANY|*. All rights reserved.
//   *|IFNOT:ARCHIVE_PAGE|**|HTML:LIST_ADDRESS_HTML|**|END:IF|*
//
// and a dead "View this email in your browser" at the top. 478 of the 480
// `campaign_emails` carry them, 15 of those are published to the PUBLIC
// newsletter archive, and every new campaign started from one inherits them.
//
// THIS IS NOT scripts/lib/email-chrome-clean.js, though it borrows from it.
// That module cleans a chrome FRAGMENT for the designer's palette, and two of
// its decisions are wrong for a whole campaign email:
//
//   1. It deletes any <p> containing *|UNSUB|*. In these emails the footer's
//      last line is
//        <a href="*|UPDATE_PROFILE|*">Update Preferences</a> |
//        <a href="*|UNSUB|*">Unsubscribe</a>
//      in ONE paragraph, so that rule would take the WORKING unsubscribe link
//      with the dead one. *|UNSUB|* is a registered tag and resolves properly
//      on a campaign send. Only the dead anchor goes.
//   2. It maps LIST_ADDRESS_HTML to *|BRAND_ADDRESS|*, which is substituted
//      at DROP TIME in the designer and resolves nowhere at send time (see
//      block-drop.util.ts). Writing that token into a saved email would just
//      swap one literal for another, so the real address is substituted here.
//
// THE ADDRESS IS NOT OPTIONAL. CAN-SPAM requires a physical postal address in
// commercial email, and the send path's fallback footer adds an unsubscribe
// link and nothing else - so deleting the address tag without putting the
// address there would remove it from every marketing send. It is built from
// the `config` document, mirroring EmailBrandDefaultsService.addressHtml().
//
// Idempotent: a second run finds nothing.

const fs = require("fs");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");
const {collapseEmptiedTextBlocks} = require("./lib/email-chrome-clean");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value === undefined ? true : value;
};

const COMPANY = "Impact Discipleship Ministries";

/** HTML-escapes a value going into markup. */
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/**
 * The footer's postal address block, from the config document.
 *
 * A hand mirror of EmailBrandDefaultsService.addressHtml() - scripts/ is
 * plain Node and cannot import the app's TypeScript, the same established
 * duplication as scripts/lib/tenancy.js. Keep the two in step.
 * @param {object} db Firestore.
 * @return {Promise<{html: string, line: string}>} Markup and a plain line.
 */
async function brandAddress(db) {
  const snap = await db.collection(tenantPath("config")).limit(1).get();
  const config = snap.empty ? {} : snap.docs[0].data();
  const a = config.address ?? {};
  const street = [a.address1, a.address2].filter((s) => s && `${s}`.trim()).join(", ");
  const city = [a.city, a.state].filter((s) => s && `${s}`.trim()).join(", ");
  const line = [street, [city, a.zip].filter(Boolean).join(" ").trim()]
    .filter((s) => s && s.length).join("<br>");
  const contact = [
    config.email ? `<a href="mailto:${esc(config.email)}">${esc(config.email)}</a>` : "",
    config.phone ? String(config.phone).replace(/\D/g, "")
      .replace(/^(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "",
  ].filter((s) => s.length).join(" &middot; ");

  return {
    html: [`<div>${COMPANY}</div>`, line ? `<div>${line}</div>` : "",
      contact ? `<div>${contact}</div>` : ""].filter((s) => s.length).join(""),
    line: [COMPANY, line.replace(/<br>/g, ", ")].filter(Boolean).join(", "),
  };
}

/**
 * One email body, with every dead tag resolved or removed.
 * @param {string} html The stored html.
 * @param {string} subject The email's own subject, for the <title> echo.
 * @param {{html: string, line: string}} address The brand address.
 * @return {string} The cleaned html.
 */
function clean(html, subject, address) {
  let out = html ?? "";

  // Mailchimp's own subject echo, which only ever sat in <title>.
  out = out.split("*|MC:SUBJECT|*").join(esc(subject));

  // The hidden preheader span and the comment-wrapped conditional round it.
  out = out.split("*|MC_PREVIEW_TEXT|*").join("");
  out = out.split("*|IF:MC_PREVIEW_TEXT|*").join("");

  // Conditionals with nothing left to guard.
  out = out.split("*|IFNOT:ARCHIVE_PAGE|*").join("");
  out = out.split("*|IF:REWARDS|*").join("");
  out = out.split("*|END:IF|*").join("");

  // Constants for this organisation.
  out = out.split("*|LIST:COMPANY|*").join(COMPANY);
  out = out.split("*|LIST:DESCRIPTION|*").join("");
  out = out.split("*|HTML:REWARDS|*").join("");

  // The address - the one tag whose CONTENT is required.
  out = out.split("*|HTML:LIST_ADDRESS_HTML|*").join(address.html);
  out = out.split("*|HTML:LIST_ADDRESS|*").join(address.html);
  out = out.split("*|LIST:ADDRESSLINE|*").join(address.line);

  // "Update Preferences" pointed at Mailchimp's profile page. Drop the
  // anchor and the separator that joined it to Unsubscribe, and NOT the
  // paragraph - see this file's header on why.
  out = out.replace(
    /<a\b[^>]*href="\*\|UPDATE_PROFILE\|\*"[^>]*>[\s\S]*?<\/a>\s*(\|&nbsp;|\|)?\s*/gi,
    ""
  );

  // "View this email in your browser" pointed at Mailchimp's hosted archive.
  // Our archive is per-send (a touch's publishToWeb flag) and unknowable
  // here, so it goes.
  //
  // ALWAYS THE ANCHOR, and the paragraph ONLY IF THE ANCHOR WAS ALL IT HELD.
  //
  // Three shapes exist in this archive and a single rule cannot serve them.
  // Deleting the whole <p> is right for the common one, where the link sits
  // alone; it is WRONG for the third, and the first run of this script proved
  // it by stripping the working unsubscribe link out of two emails:
  //
  //   <p><a href="*|ARCHIVE|*">View this email in your browser</a></p>
  //     the newer `mceText` export - the paragraph is the link, so it goes,
  //     and collapseEmptiedTextBlocks removes the ~28px band left behind.
  //
  //   <td class="mcnTextContent"><a href="*|ARCHIVE|*">...</a>
  //     the older export - a bare anchor in a padded cell, no <p> at all.
  //
  //   <p><a href="*|ARCHIVE|*">..</a><br>ADDRESSLINE<br>
  //      <a href="*|UPDATE_PROFILE|*">..</a> or <a href="*|UNSUB|*">..</a></p>
  //     one paragraph carrying the whole footer. Taking it deletes the
  //     address and the unsubscribe link with the dead one.
  //
  // So: strip the anchor everywhere, then drop only a paragraph that has
  // nothing left in it.
  out = out.replace(
    /<a\b[^>]*href="\*\|ARCHIVE\|\*"[^>]*>[\s\S]*?<\/a>/gi,
    ""
  );
  out = out.replace(/<p\b[^>]*>((?:(?!<\/p>)[\s\S])*?)<\/p>/gi, (whole, inner) => {
    const hasText = inner.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") !== "";
    const hasLink = /<a\b/i.test(inner);
    const hasImage = /<img\b/i.test(inner);
    return hasText || hasLink || hasImage ? whole : "";
  });
  // Deliberately NOT trying to remove the surrounding <td> or <tr>:
  // email-chrome-clean.js records what a generic "drop any empty container"
  // sweep did last time - it deleted deliberate spacers and half of an
  // Outlook conditional, which makes Outlook swallow the rest of the
  // document. A few pixels of empty header is the cheaper mistake.

  return collapseEmptiedTextBlocks(out);
}

/** Every dead tag still present - *|UNSUB|* and *|CURRENT_YEAR|* are real. */
function leftovers(html) {
  const found = (html ?? "").match(/\*\|[^|*]{1,60}\|\*/g) ?? [];
  return [...new Set(found)].filter((t) => !["*|UNSUB|*", "*|CURRENT_YEAR|*",
    "*|FNAME|*", "*|LNAME|*", "*|EMAIL|*", "*|DATE|*"].includes(t));
}

(async () => {
  const project = arg("project");
  if (!project) {
    console.error("Usage: node scripts/clean-mailchimp-tags.js " +
      "--project=dev|prod [--backup=file.json] [--execute]");
    process.exit(1);
  }
  const execute = !!arg("execute");
  const backupPath = arg("backup");
  const db = getFirestoreFor(resolveProjectId(project));

  const address = await brandAddress(db);
  if (!address.html.includes("<div>")) {
    throw new Error("No address could be built from the config document - " +
      "refusing to strip the address tag with nothing to put in its place.");
  }
  console.log(`project ${project} | ${execute ? "EXECUTE" : "dry run"}`);
  console.log(`address: ${address.html}\n`);

  const path = tenantPath("campaign_emails");
  const snap = await db.collection(path).get();
  if (snap.empty) {
    throw new Error(`No documents at "${path}".`);
  }

  const backup = [];
  let changed = 0;
  const stillDirty = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const before = data.html ?? "";
    const after = clean(before, data.subject ?? "", address);
    if (after === before) continue;

    changed++;
    backup.push({id: doc.id, html: before});
    const rest = leftovers(after);
    if (rest.length) {
      stillDirty.push(`${doc.id}: ${rest.join(", ")}`);
    }
    if (execute) {
      await doc.ref.update({html: after});
    }
  }

  if (backupPath && backup.length) {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
    console.log(`backed up ${backup.length} original bodies -> ${backupPath}\n`);
  }

  console.log(`${changed} of ${snap.size} emails ` +
    `${execute ? "cleaned" : "would be cleaned"}.`);
  if (stillDirty.length) {
    console.log(`\n${stillDirty.length} still carry a tag this script does ` +
      "not know about:");
    stillDirty.slice(0, 20).forEach((s) => console.log("  " + s));
  } else {
    console.log("No unresolvable tags remain.");
  }
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
