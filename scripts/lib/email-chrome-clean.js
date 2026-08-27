// Makes a mined chrome fragment safe to drop into ANY email design.
//
// Used by two callers that MUST agree:
//   scripts/extract-email-chrome.js   applies it while regenerating
//                                     src/app/common/utils/email/archive-shells.ts
//   scripts/clean-archive-shells.js   applied it once to the already-committed
//                                     file, so the shells you have today are
//                                     the shells you keep (re-mining prod would
//                                     have swapped the mastheads out)
//
// Two problems are fixed here, both of which only became urgent when the
// designer gained a chrome palette (2026-08-27): until then a shell could only
// be applied to a BRAND NEW template, and now it can land on a shipping
// confirmation.
//
//   1. Mailchimp system tags. The account is retired and none of our senders
//      resolve these. renderMergeTags leaves an unknown tag EXACTLY as written
//      (a literal tag in an inbox is a visible bug someone reports, where
//      silently deleting it is not), so every one of them would print raw to a
//      customer.
//
//   2. A loose <td>. Every mined fragment is a bare cell with no row, and the
//      compiler puts each block's content inside its OWN <td> - so pasted
//      as-is a shell compiles to <td><td>...</td></td>. Clients drop the stray
//      cell, which is why this looked fine while it was only ever a starter.
"use strict";

/**
 * Wraps a loose <td>...</td> in its own single-cell table.
 *
 * Deliberately WRAPPING rather than unwrapping: the mined header cells carry
 * align="center" (which is what centres the masthead table) and valign="top",
 * neither of which a <div> honours. Wrapping keeps every attribute doing
 * exactly what it did in the email this was mined from, where it was also
 * inside a row - measured at 0px difference on all five shells.
 * @param {string} html A chrome fragment.
 * @return {string} The fragment, valid wherever a block's content can go.
 */
function wrapLooseCell(html) {
  const trimmed = (html ?? "").trim();
  if (!/^<td\b/i.test(trimmed) || !/<\/td>$/i.test(trimmed)) {
    return trimmed;
  }
  return (
    "<table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\">" +
    "<tbody><tr>" + trimmed + "</tr></tbody></table>"
  );
}

/**
 * Replaces or removes every Mailchimp system tag.
 *
 * CURRENT_YEAR survives as a real registered merge tag (see MERGE_TAGS).
 * LIST_ADDRESS_HTML becomes *|BRAND_ADDRESS|*, an INTERNAL placeholder the
 * designer substitutes at drop time from the config doc - it never reaches a
 * saved design, so it can never reach an inbox.
 * @param {string} html A chrome fragment.
 * @return {string} The fragment with no unresolvable tags left.
 */
function cleanMailchimpTags(html) {
  return (html ?? "")
    // The archive-page conditional has no archive page left to guard.
    .replace(/\*\|IFNOT:ARCHIVE_PAGE\|\*/g, "")
    .replace(/\*\|END:IF\|\*/g, "")
    // The list's company name is a constant for this organisation.
    .replace(/\*\|LIST:COMPANY\|\*/g, "Impact Discipleship Ministries")
    .replace(/\*\|HTML:LIST_ADDRESS_HTML\|\*/g, "*|BRAND_ADDRESS|*")
    // Whole lines that exist only to carry a dead link:
    //   UNSUB / UPDATE_PROFILE - campaign-send.functions.ts appends an
    //     unsubscribe footer to any marketing send whose html lacks one, so
    //     dropping it here is correct in BOTH directions: a campaign still
    //     gets one, and a transactional email stops carrying the dead "#"
    //     that *|UNSUB|* resolves to on every non-campaign send path.
    //   ARCHIVE - "View this email in your browser" pointed at Mailchimp's
    //     hosted archive. Our own archive is per-send (a touch's publishToWeb
    //     flag) and unknowable at design time, so there is nothing to aim it
    //     at. If that ever gains a merge tag, this is the line to restore.
    .replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<\/p>/gi, (paragraph) =>
      /\*\|UNSUB\|\*|\*\|UPDATE_PROFILE\|\*|\*\|ARCHIVE\|\*/.test(paragraph) ? "" : paragraph);
}

/**
 * Removes a Mailchimp text block that cleanMailchimpTags just emptied.
 *
 * A text block is a <div class="mceText"> inside a padded cell inside its own
 * table, so removing its only <p> otherwise leaves a ~28px blank band.
 *
 * GUARDED HARD, and the guards are not theoretical. The first version of this
 * was a generic "drop any empty container" sweep, and it deleted
 * <td class="mceSpacerBlock" height="20"> (a deliberate 20px spacer) and both
 * halves of <!--[if !mso]><!--> ... <!--<![endif]--> - an unbalanced
 * conditional can make Outlook swallow the rest of the document. It shrank
 * shells 4 and 5 by 526 chars each for no reason at all. A candidate must look
 * like a text block and contain nothing else whatsoever.
 * @param {string} html A chrome fragment, tags already cleaned.
 * @return {string} The fragment without the emptied block.
 */
function collapseEmptiedTextBlocks(html) {
  // One block's <tr>. Non-greedy and must not span another <tr>.
  const rowPattern = /<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr>/gi;
  return (html ?? "").replace(rowPattern, (whole, inner) => {
    const looksLikeTextBlock = /mceText/i.test(inner);
    const hasText = inner.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") !== "";
    const hasImage = /<img\b|background-image/i.test(inner);
    const hasConditional = /<!--\[if|<!\[endif\]/i.test(inner);
    const hasSpacer = /mceSpacerBlock|height\s*=\s*"\d/i.test(inner);
    const safeToDrop =
      looksLikeTextBlock && !hasText && !hasImage && !hasConditional && !hasSpacer;
    return safeToDrop ? "" : whole;
  });
}

/**
 * The whole transform, in the order the two callers must apply it.
 * @param {string} html A header or footer fragment as mined.
 * @return {string} A fragment safe to drop into any design.
 */
function cleanChromeFragment(html) {
  return wrapLooseCell(collapseEmptiedTextBlocks(cleanMailchimpTags(html)));
}

/** Tags a cleaned fragment is ALLOWED to still contain. Anything else means
 *  the transform missed something new in the archive. */
const ALLOWED_TAGS = ["*|CURRENT_YEAR|*", "*|BRAND_ADDRESS|*"];

/**
 * Every merge tag left in a cleaned fragment that nothing can resolve.
 *
 * Callers refuse to write when this is non-empty. It exists because the first
 * dry run of this transform missed *|ARCHIVE|* entirely - it was in the
 * HEADERS, and the tags had only been read out of the footers.
 * @param {string} html A cleaned fragment.
 * @return {string[]} The offending tags, deduplicated.
 */
function unresolvableTags(html) {
  const plain = (html ?? "").match(/\*\|[^|*]{1,60}\|\*/g) ?? [];
  // The colon-bearing forms (LIST:COMPANY, HTML:LIST_ADDRESS_HTML) do not
  // match the tag grammar renderMergeTags uses, so they need their own sweep.
  const colon = (html ?? "").match(/\*\|[A-Z_]+:[^|*]*\|\*/g) ?? [];
  return [...new Set([...plain, ...colon])].filter((tag) => !ALLOWED_TAGS.includes(tag));
}

module.exports = {
  ALLOWED_TAGS,
  cleanChromeFragment,
  cleanMailchimpTags,
  collapseEmptiedTextBlocks,
  unresolvableTags,
  wrapLooseCell
};
