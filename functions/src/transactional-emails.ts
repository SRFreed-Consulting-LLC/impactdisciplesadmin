import {tenantPath} from "./common/shared/lists/tenancy";
const TEMPLATES = tenantPath("mail_templates");
import {Timestamp} from "firebase-admin/firestore";
import {renderEmailBody} from "./utils/merge-tags.functions";
import {
  MAIL_TEMPLATE_IDS,
  resolveCodeTemplate,
} from "./utils/mail-templates.functions";

// Pre-prod hardening #1: every email the two public apps used to compose
// and write into `mail` from the browser is queued server-side here
// instead, so the `mail` collection's create rule can require staff.
// Each builder is a faithful port of the client code it replaces (noted
// per function) - the Trigger Email extension picks the docs up exactly
// as before, nothing about delivery changes.

// Environment-aware (same switch as READER_APP_ORIGIN below,
// library-push-notifications.ts, and the PayPal base URL). This was
// hardcoded to the dev project, so every production email's unsubscribe link
// flipped the flag in the WRONG database: the recipient saw a success page
// and kept receiving mail. That is a CAN-SPAM exposure, not just a broken
// link - an unsubscribe request has to actually take effect.
// Exported since 2026-08-18: campaign-auto-send.functions.ts builds each
// recipient's *|UNSUB|* link from the same per-environment endpoint.
export const UNSUBSCRIBE_URL =
  process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
    "https://us-central1-impactdisciples-a82a8.cloudfunctions.net/" +
      "unsubscribe_from_email_list" :
    "https://us-central1-impactdisciplesdev.cloudfunctions.net/" +
      "unsubscribe_from_email_list";
/**
 * The free-ebook download link offered in the newsletter confirmation, read
 * from the `config` singleton rather than hardcoded.
 *
 * It used to be a literal tokened Storage URL here, and the SAME token also
 * shipped in the Angular bundle as environment.freeEbookUrl (a dead key,
 * deleted 2026-08-28). Rotating a leaked Storage token therefore meant a
 * source edit plus a functions deploy - which is exactly why it had not been
 * done. On config it is a data edit and nothing else.
 *
 * Returns null when unset, and the caller then OMITS the offer rather than
 * emitting a dead link: ~400 people a year receive this email, and a link
 * that 403s is worse than no link. The warning is there because a silently
 * missing offer is the failure mode this shape introduces.
 *
 * Same singleton rule getPaypalClientId uses - read the collection and refuse
 * to guess rather than limit(1) onto an arbitrary document.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @return {Promise<string | null>} The URL, or null when not configured.
 */
async function freeEbookUrl(
  db: FirebaseFirestore.Firestore
): Promise<string | null> {
  const snap = await db.collection(tenantPath("config")).get();
  if (snap.empty || snap.size > 1) {
    console.error(
      `freeEbookUrl: expected one config document, found ${snap.size} - ` +
      "omitting the free ebook offer from this confirmation."
    );
    return null;
  }
  const url = snap.docs[0].data()?.freeEbookUrl;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    console.warn(
      "freeEbookUrl is not set on the config document, so the newsletter " +
      "confirmation is going out WITHOUT its free ebook offer. Set it with " +
      "scripts/seed-free-ebook-url.js."
    );
    return null;
  }
  return url;
}
// Environment-aware (same switch as library-push-notifications.ts and the
// PayPal base URL): production project -> real reader domain, else dev.
const READER_APP_ORIGIN =
  process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
    "https://library.impactdisciples.com" :
    "https://impactdisciplesdev-library.web.app";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * HTML-escapes a string for safe interpolation into email markup.
 * @param {unknown} value Raw value.
 * @return {string} Escaped string.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Crude but sufficient text alternative for HTML mail bodies - same role
 * as the web app's htmlToPlainText util.
 * @param {string} html HTML body.
 * @return {string} Plain-text approximation.
 */
export function htmlToPlainText(html: string): string {
  return html
    // <style>/<script> bodies are NOT markup the tag-stripper below can
    // handle: stripping the tags alone leaves the CSS/JS *text* behind, so
    // every styled template used to queue mail whose plain-text part began
    // with a wall of raw CSS (".a{color:red}Hi Sam..."). Drop the whole
    // element, contents included, before anything else runs.
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Substitutes {{key}} placeholders in a mail template body.
 *
 * NO PRODUCTION CALLERS as of 2026-08-27 - every send path moved to
 * utils/merge-tags.functions.ts's renderEmailBody(), which resolves {{key}}
 * AND *|TAG|* in the same single pass, because templates are now editable in
 * the email builder and its tag menu writes the other syntax. Kept, with its
 * tests, as the reference statement of the single-pass rule below; delete it
 * only along with them.
 *
 * Deliberately ARBITRARY-key: the caller's model decides which placeholders
 * exist, because staff author these templates in the admin UI and can use
 * whatever names the calling function supplies. This is NOT the same thing
 * as utils/merge-tags.functions.ts's renderMergeTags(), which resolves a
 * fixed, closed MERGE_TAGS list for campaign sends - the two are separate on
 * purpose and must not be collapsed into one another.
 *
 * Values are substituted verbatim; callers are responsible for escaping
 * anything user-supplied BEFORE building the model (see escapeHtml usage at
 * every call site).
 *
 * SINGLE PASS, on purpose. The three inline loops this replaced each walked
 * Object.entries(model) substituting one key at a time, which meant a value
 * substituted early was itself rescanned for placeholders by every later
 * iteration. escapeHtml does not escape braces, and fields like firstName
 * come straight off a public endpoint, so an attacker registering as
 * "{{editRegistration}}" got that later model value expanded into the name
 * position of their own confirmation email. Scanning the TEMPLATE once and
 * looking each tag up in the model closes that: substituted text is output,
 * never input.
 * @param {string} html The template body.
 * @param {Record<string, string>} model Placeholder name -> replacement.
 * @return {string} The rendered body.
 */
export function renderPlaceholders(
  html: string,
  model: Record<string, string>
): string {
  return html.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) =>
      // hasOwnProperty, not `key in model` / `model[key]` - an inherited
      // property name in a template ("{{constructor}}") must stay literal
      // rather than interpolating something off Object.prototype.
      Object.prototype.hasOwnProperty.call(model, key) ? model[key] : match
  );
}

/**
 * Queues one email document for the Trigger Email extension.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} to Recipient address.
 * @param {string} subject Subject line.
 * @param {string} html HTML body.
 * @param {object} [campaignMeta] Campaign-send provenance
 * ({campaignId, emailId, sendId}) - the extension ignores unknown fields,
 * and onCampaignMailDelivered (campaign-send.functions.ts) uses it to
 * write the delivered signal back onto the send ledger. Omit for
 * transactional mail.
 * @return {Promise<string>} The queued mail doc id.
 */
export async function queueMail(
  db: FirebaseFirestore.Firestore,
  to: string,
  subject: string,
  html: string,
  campaignMeta?: {campaignId: string; emailId: string; sendId: string}
): Promise<string> {
  const ref = await db.collection("mail").add({
    to,
    date: Timestamp.now(),
    message: {subject, html, text: htmlToPlainText(html)},
    ...(campaignMeta ? {campaignMeta} : {}),
  });
  return ref.id;
}

/**
 * Newsletter / Prayer Team subscription confirmation - ported from
 * impactdisciples-web's SubscriptionService.sendConfirmationEmail (which
 * is retired). Both types now go out as HTML (the old prayer branch sent
 * message.text that embedded HTML tags, which rendered as raw markup).
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} type "newsletter" or "prayer".
 * @param {string} firstName Subscriber first name.
 * @param {string} email Subscriber address.
 * @return {Promise<void>} Resolves when queued.
 */
export interface SignupReward {
  code: string;
  percentOff: number;
  expiresAt: number | null;
}

/**
 * The reward block a campaign-issued coupon adds to a confirmation email.
 * Empty when the signup earned nothing, which is the normal case.
 * @param {SignupReward | null} reward The coupon, or null.
 * @return {string} HTML, or an empty string.
 */
function rewardBlock(reward: SignupReward | null): string {
  if (!reward?.code) {
    return "";
  }
  const expiry = reward.expiresAt ?
    "<div>Use it by " +
      new Date(reward.expiresAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      }) + ".</div>" :
    "";
  return "<br><br><div>Here is <b>" + reward.percentOff +
    "% off</b> your next order, with our thanks. Use code <b>" +
    escapeHtml(reward.code) + "</b> at checkout.</div>" + expiry;
}

export async function queueSubscriptionConfirmation(
  db: FirebaseFirestore.Firestore,
  type: string,
  firstName: string,
  email: string,
  reward: SignupReward | null = null
): Promise<void> {
  const unsubscribe =
    "<br><br><br><div>If you believe you received this confirmation by " +
    "mistake, please click <b><a href='" + UNSUBSCRIBE_URL + "?email=" +
    encodeURIComponent(email) + "&type=" + type +
    "'>here</a></b> to remove your address.</div>";

  if (type === "prayer") {
    const subject = "Thank you for Joining our Prayer Team! ";
    const html =
      "<div>Dear " + escapeHtml(firstName) + ".</div><br><br>" +
      "<div>Your email address was successfully added to our Prayer " +
      "Team List! (" + escapeHtml(email) + ")</div><br><br>" +
      rewardBlock(reward) +
      "<br><br><div>God Bless! - Impact Disciples Ministry</div>" + unsubscribe;
    await queueMail(db, email, subject, html);
    return;
  }

  // Resolved before the html is built so a missing/misconfigured URL drops
  // the offer cleanly instead of rendering href="null".
  const ebookUrl = await freeEbookUrl(db);
  const ebookBlock = ebookUrl ?
    "<div>Please accept this free <a href=\"" + ebookUrl +
      "\" download>EBook</a> as a small token of our appreciation.</div>" :
    "";

  const subject =
    "Thank you for Subscribing to the Impact Disciples Newletter!";
  const html =
    "<div>Dear " + escapeHtml(firstName) + ".</div><br><br>" +
    "<div>Your email address was successfully added to our Newletter " +
    "Subsciption List! (" + escapeHtml(email) + ")</div><br><br>" +
    ebookBlock +
    rewardBlock(reward) +
    "<br><br><div>God Bless! - Impact Disciples Ministry</div>" + unsubscribe;
  await queueMail(db, email, subject, html);
}

interface ReceiptCartItem {
  itemName?: string;
  price?: number;
  salePrice?: number;
  discount?: number;
  orderQuantity?: number;
  isEBook?: boolean;
  isDigitalBook?: boolean;
  eBookUrl?: {url?: string};
  img?: {url?: string; name?: string};
  followUpEmailId?: string;
}

interface ReceiptCheckoutForm {
  firstName?: string;
  lastName?: string;
  email?: string;
  cartItems?: ReceiptCartItem[];
  estimatedTaxes?: number;
  shippingRate?: number;
  shippingDiscount?: number;
  receipt?: string;
}

/**
 * Sale-price-first unit price - mirror of the web PricingService.
 * @param {ReceiptCartItem} item Cart line.
 * @return {number} Effective unit price.
 */
function effectiveUnitPrice(item: ReceiptCartItem): number {
  if (typeof item.salePrice === "number" && item.salePrice > 0) {
    return item.salePrice;
  }
  return typeof item.price === "number" ? item.price : 0;
}

/**
 * Builds the product_list table for the web store's "Sales Receipt"
 * template - ported from CheckoutComponent.sendProductPurchaseSuccessEmail
 * (retired), same math as the web PricingService.
 *
 * Rebuilt 2026-08-27 for the email BUILDER. The original was a 7-column
 * table at width:90% with 100px product images, and the template dropped it
 * inside a <span> inside a <p> - a table nested in a paragraph, which every
 * mail client hoists back out, taking the layout with it. Its rows were also
 * ragged: the header had 7 cells, a plain item row 6, an eBook row 7, so
 * columns never lined up with their own headings.
 *
 * Now FOUR columns, every row the same width, sized for the builder's 600px
 * canvas: thumbnail | product (with per-unit price and any download link) |
 * qty | line total. Table attributes as well as inline styles, because
 * Outlook ignores CSS on <table>. The MATH is untouched.
 * @param {ReceiptCheckoutForm} form The saved checkout form.
 * @return {string} HTML table markup.
 */
export function buildWebProductListHtml(form: ReceiptCheckoutForm): string {
  const items = form.cartItems ?? [];
  let ebooksPurchased = false;
  let subtotal = 0;
  let discountTotal = 0;

  const font = "font-family:Helvetica,Arial,sans-serif;";
  const cell = "padding:10px 8px;border-bottom:1px solid #e5e7eb;" + font +
    "font-size:14px;color:#333333;";
  const head = "padding:8px;border-bottom:2px solid #d1d5db;" + font +
    "font-size:11px;letter-spacing:.06em;color:#6a7280;";
  const totalCell = "padding:6px 8px;" + font +
    "font-size:14px;color:#333333;";

  let html = "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" " +
    "cellspacing=\"0\" border=\"0\" " +
    "style=\"width:100%;border-collapse:collapse;\">";
  html += "<tr>" +
    "<th style=\"" + head + "text-align:left;\" colspan=\"2\">PRODUCT</th>" +
    "<th style=\"" + head + "text-align:center;\">QTY</th>" +
    "<th style=\"" + head + "text-align:right;\">TOTAL</th>" +
    "</tr>";

  for (const item of items) {
    const unit = effectiveUnitPrice(item);
    const qty = item.orderQuantity ?? 0;
    const unitDiscount = typeof item.discount === "number" ?
      item.discount : 0;
    const lineTotal = (unit * qty) - (unitDiscount * qty);
    subtotal += unit * qty;
    discountTotal += unitDiscount * qty;

    // Per-unit price sits UNDER the product name rather than in its own
    // column - four columns fit 600px, six do not.
    let detail = "<div style=\"font-size:12px;color:#6a7280;\">" +
      usd.format(unit) + " each";
    if (unitDiscount > 0) {
      detail += " - less " + usd.format(unitDiscount) + " each";
    }
    detail += "</div>";

    if (item.isEBook) {
      detail += "<div style=\"font-size:13px;\"><a href=\"" +
        escapeHtml(item.eBookUrl?.url ?? "") +
        "\" download>DOWNLOAD</a></div>";
    }
    if (item.isDigitalBook) {
      ebooksPurchased = true;
      detail += "<div style=\"font-size:12px;color:#6a7280;\">" +
        "See install instructions below!</div>";
    }

    const img = item.img?.url ?
      "<img src=\"" + escapeHtml(item.img.url) + "\" alt=\"" +
        escapeHtml(item.img?.name ?? "") + "\" width=\"64\" " +
        "style=\"display:block;width:64px;height:auto;\">" :
      "";

    html += "<tr>";
    html += "<td style=\"" + cell + "width:72px;\">" + img + "</td>";
    html += "<td style=\"" + cell + "text-align:left;\">" +
      escapeHtml(item.itemName ?? "") + detail + "</td>";
    html += "<td style=\"" + cell + "text-align:center;\">" + qty + "</td>";
    html += "<td style=\"" + cell + "text-align:right;\">" +
      usd.format(lineTotal) + "</td>";
    html += "</tr>";
  }

  const taxes = form.estimatedTaxes ?? 0;
  const shipping = form.shippingRate ?? 0;
  const shippingDiscount = form.shippingDiscount ?? 0;
  const orderTotal =
    subtotal - discountTotal + taxes + shipping - shippingDiscount;

  // Every totals row is label + value across the same four columns, so they
  // line up under TOTAL instead of drifting into the QUANTITY column the way
  // the old markup did.
  const totalsRow = (label: string, value: string, strong = false) =>
    "<tr><td colspan=\"3\" style=\"" + totalCell + "text-align:right;\">" +
    (strong ? "<b>" + label + "</b>" : label) + "</td>" +
    "<td style=\"" + totalCell + "text-align:right;\">" +
    (strong ? "<b>" + value + "</b>" : value) + "</td></tr>";

  html += totalsRow("SUBTOTAL", usd.format(subtotal));
  if (discountTotal > 0) {
    html += totalsRow("DISCOUNT", "- " + usd.format(discountTotal));
  }
  if (taxes > 0) {
    html += totalsRow("TAXES", "+ " + usd.format(taxes));
  }
  if (shipping > 0) {
    html += totalsRow("SHIPPING", "+ " + usd.format(shipping));
  }
  if (shippingDiscount > 0) {
    html += totalsRow("SHIPPING DISCOUNT", "- " + usd.format(shippingDiscount));
  }
  html += totalsRow("TOTAL", usd.format(orderTotal), true);
  html += "</table>";

  if (form.receipt) {
    html += "<div style=\"margin-top:12px;" + font +
      "font-size:13px;color:#6a7280;\">Confirmation Id: <b>" +
      escapeHtml(form.receipt) + "</b></div>";
  }
  if (ebooksPurchased) {
    html += "<div style=\"margin-top:16px;" + font +
      "font-size:14px;color:#333333;\"><b>If you purchased an item from our " +
      "Digital Library, instructions for setting up the Library on your " +
      "preferred device can be found <a href=\"" +
      "https://library.impactdisciples.com/install-instructions\">here</a>!" +
      "</b></div>";
    html += "<div style=\"margin-top:6px;" + font +
      "font-size:13px;color:#6a7280;\">(For easy installation, it is best to " +
      "open this email on your preferred device and click the link!)</div>";
  }
  return html;
}

/**
 * Queues the web store's sales receipt (rendered from the "Sales Receipt"
 * mail_templates doc) plus any per-product follow-up emails - replacing
 * CheckoutComponent.sendProductPurchaseSuccessEmail and
 * CheckoutSuccessComponent.sendProductFollowUpEmail (both retired).
 * Best-effort by contract: callers wrap this so an email failure can
 * never fail an order that already saved.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {unknown} checkoutForm The saved checkout form.
 * @return {Promise<void>} Resolves when all emails are queued.
 */
export async function queueWebOrderEmails(
  db: FirebaseFirestore.Firestore,
  checkoutForm: unknown
): Promise<void> {
  const form = checkoutForm as ReceiptCheckoutForm;
  const email = (form.email ?? "").trim();
  if (!email) {
    return;
  }

  // By pinned ID, not by name - a name is an editable text field, and
  // renaming this template used to stop every receipt with no error
  // anywhere. resolveCodeTemplate still falls back to the name, loudly, so a
  // project whose data has not been pinned yet keeps sending.
  const resolved = await resolveCodeTemplate(
    db, MAIL_TEMPLATE_IDS.salesReceipt, "Sales Receipt"
  );

  if (!resolved) {
    // LOUD. This used to be `if (!templateSnap.empty)` with no else, so a
    // missing template meant a paying customer silently received no receipt
    // at all and nothing anywhere recorded it. The order is already captured
    // by the time this runs, so throwing would be worse than useless - but
    // saying so in the log is the difference between a reported bug and a
    // mystery.
    console.error(
      "No Sales Receipt template could be resolved - order " +
      `${form.receipt ?? "(no receipt id)"} was charged and NO receipt ` +
      "was sent."
    );
  } else {
    const template = resolved.data;
    // Buyer-supplied fields are HTML-escaped before substitution
    // (sweep 2026-08-17). product_list is builder-generated markup (its own
    // interpolations are already escaped), so it is inserted as-is.
    const model: Record<string, string> = {
      firstName: escapeHtml(form.firstName ?? ""),
      lastName: escapeHtml(form.lastName ?? ""),
      email: escapeHtml(email),
      product_list: buildWebProductListHtml(form),
    };
    const html = renderEmailBody(template.html ?? "", model);
    // The SUBJECT gets its own model: unescaped (a subject is plain text, so
    // "Smith &amp; Co" would be shown literally) and without product_list,
    // which is a block of markup and has no business in a subject line.
    // Rendered at all because an admin editing this in the builder can type a
    // tag into the subject field and reasonably expect it to resolve - it
    // used to be passed through raw.
    const subject = renderEmailBody(template.subject || "Sales Receipt", {
      firstName: form.firstName ?? "",
      lastName: form.lastName ?? "",
      email,
    });
    await queueMail(db, email, subject, html);
  }

  // Per-item follow-ups run CONCURRENTLY (they used to be a serial
  // read-then-queue loop, which sat on capture_paypal_order's critical
  // path - the customer stared at "Finishing your order..." while each
  // template was fetched one at a time).
  const followUps = (form.cartItems ?? [])
    .filter((item) => !!item.followUpEmailId);
  await Promise.all(followUps.map(async (item) => {
    const followUpSnap = await db.collection(TEMPLATES)
      .doc(item.followUpEmailId as string).get();
    if (!followUpSnap.exists) {
      // Also loud, for the same reason as the receipt above: a product whose
      // follow-up template has been deleted quietly stops delivering whatever
      // the customer actually paid for - a video link, a download - and the
      // order looks completely successful from every angle.
      console.error(
        `A purchased item names follow-up template ${item.followUpEmailId}, ` +
        `which does not exist - nothing sent to ${email}.`
      );
      return;
    }
    const followUp = followUpSnap.data() as {subject?: string;
      html?: string};
    // renderEmailBody: one pass, both tag syntaxes. A product's follow-up is
    // admin-editable in the email BUILDER, whose tag menu inserts *|FNAME|*,
    // while the Quill-authored templates in the live data use {{firstName}} -
    // and whichever renderer only knew one of those would mail the other to a
    // customer verbatim, with nothing erroring anywhere.
    const html = renderEmailBody(followUp.html ?? "", {
      firstName: escapeHtml(form.firstName ?? ""),
      lastName: escapeHtml(form.lastName ?? ""),
      email: escapeHtml(email.toLowerCase()),
    });
    // `||`, not `??`: a template saved with an empty subject would otherwise
    // mail with no subject line at all, which reads as spam.
    const subject = renderEmailBody(
      followUp.subject || "Thank you for your order",
      {
        firstName: form.firstName ?? "",
        lastName: form.lastName ?? "",
        email,
      }
    );
    await queueMail(db, email, subject, html);
  }));
}

export interface ReaderReceiptLine {
  title: string;
  effectivePrice: number;
  discount: number;
  finalPrice: number;
}

/**
 * Reader-store purchase receipt - ported from the reader
 * StoreComponent.buildReceiptEmailHtml (retired).
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} email Buyer address.
 * @param {string} firstName Buyer first name ("there" fallback applied).
 * @param {ReaderReceiptLine[]} lines Server-computed line items.
 * @param {number} total Total charged.
 * @param {string} receipt Confirmation id shown to the buyer.
 * @return {Promise<void>} Resolves when queued.
 */
export async function queueReaderReceiptEmail(
  db: FirebaseFirestore.Firestore,
  email: string,
  firstName: string | undefined,
  lines: ReaderReceiptLine[],
  total: number,
  receipt: string
): Promise<void> {
  const name = firstName || "there";
  const rows = lines.map((line) =>
    "<tr>" +
    "<td style=\"padding: 4px 8px; text-align: left;\">" +
    escapeHtml(line.title) + "</td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\">" +
    usd.format(line.effectivePrice) + "</td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\">" +
    (line.discount > 0 ? "-" + usd.format(line.discount) : "") + "</td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\">" +
    usd.format(line.finalPrice) + "</td>" +
    "</tr>").join("");

  const html =
    "<p>Hi " + escapeHtml(name) + ",</p>" +
    "<p>Thanks for your purchase! You now have access to the following " +
    "in the Impact Discipleship Library:</p>" +
    "<table style=\"width: 100%; border-collapse: collapse;\">" +
    "<tr>" +
    "<td style=\"padding: 4px 8px; text-align: left;\"><b>Book</b></td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\"><b>Price</b></td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\"><b>Discount</b>" +
    "</td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\"><b>Total</b></td>" +
    "</tr>" + rows +
    "<tr>" +
    "<td colspan=\"3\" style=\"padding: 4px 8px; text-align: right;\">" +
    "<b>Total charged</b></td>" +
    "<td style=\"padding: 4px 8px; text-align: right;\"><b>" +
    usd.format(total) + "</b></td>" +
    "</tr></table>" +
    "<p>Confirmation: <b>" + escapeHtml(receipt) + "</b></p>" +
    "<p>You can start reading right away - just open the Library and " +
    "the book(s) above will already be there.</p>";

  await queueMail(
    db, email, "Your Impact Discipleship Library purchase", html
  );
}

/**
 * Impact Group invite email - ported from the reader
 * InviteMemberDialogComponent.buildInviteEmailHtml (retired). The meeting
 * line is rebuilt from the group doc's own fields server-side.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} inviteeEmail Recipient.
 * @param {string} inviteId The created groupInvites doc id.
 * @param {string} leaderDisplayName Leader's display name.
 * @param {string} groupTitle Group title.
 * @param {string} bookTitle Book title (display only).
 * @param {string} meetingLine Preformatted when/where line.
 * @return {Promise<void>} Resolves when queued.
 */
export async function queueGroupInviteEmail(
  db: FirebaseFirestore.Firestore,
  inviteeEmail: string,
  inviteId: string,
  leaderDisplayName: string,
  groupTitle: string,
  bookTitle: string,
  meetingLine: string
): Promise<void> {
  const inviteUrl = READER_APP_ORIGIN + "/invite/" + inviteId;
  const html =
    "<p>Hi there,</p>" +
    "<p>" + escapeHtml(leaderDisplayName) +
    " has invited you to join their Impact Group, <b>" +
    escapeHtml(groupTitle) + "</b>" +
    (bookTitle ? ", studying <b>" + escapeHtml(bookTitle) + "</b>" : "") +
    ".</p>" +
    "<p><b>When/where:</b> " + meetingLine + "</p>" +
    "<p>Would you like to join?</p>" +
    "<p><a href=\"" + inviteUrl + "\" style=\"display: inline-block; " +
    "padding: 10px 20px; background: #2e7d32; color: #fff; " +
    "text-decoration: none; border-radius: 4px;\">View this invite" +
    "</a></p>" +
    "<p>If you'd like to join, that link will walk you through creating " +
    "a free account in the Impact Discipleship Library app.</p>";

  await queueMail(
    db,
    inviteeEmail,
    "You're invited to join an Impact Group: " + groupTitle,
    html
  );
}

/**
 * Decline notification to the group leader - ported from the reader
 * InviteLandingComponent.buildDeclineNotificationHtml (retired).
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} leaderEmail Recipient (the leader).
 * @param {string} leaderDisplayName Leader's display name.
 * @param {string} groupTitle Group title.
 * @param {string} inviteeEmail Who declined.
 * @param {string | undefined} reason Optional decline reason.
 * @return {Promise<void>} Resolves when queued.
 */
export async function queueInviteDeclineEmail(
  db: FirebaseFirestore.Firestore,
  leaderEmail: string,
  leaderDisplayName: string,
  groupTitle: string,
  inviteeEmail: string,
  reason: string | undefined
): Promise<void> {
  const html =
    "<p>Hi " + escapeHtml(leaderDisplayName) + ",</p>" +
    "<p>" + escapeHtml(inviteeEmail) +
    " has declined your invitation to join <b>" +
    escapeHtml(groupTitle) + "</b>.</p>" +
    (reason ? "<p><i>\"" + escapeHtml(reason) + "\"</i></p>" : "");

  await queueMail(
    db,
    leaderEmail,
    inviteeEmail + " declined your Impact Group invite",
    html
  );
}
