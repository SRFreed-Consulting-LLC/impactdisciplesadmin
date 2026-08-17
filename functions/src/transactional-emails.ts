import * as admin from "firebase-admin";

// Pre-prod hardening #1: every email the two public apps used to compose
// and write into `mail` from the browser is queued server-side here
// instead, so the `mail` collection's create rule can require staff.
// Each builder is a faithful port of the client code it replaces (noted
// per function) - the Trigger Email extension picks the docs up exactly
// as before, nothing about delivery changes.

const UNSUBSCRIBE_URL =
  "https://us-central1-impactdisciplesdev.cloudfunctions.net/" +
  "unsubscribe_from_email_list";
const FREE_EBOOK_URL =
  "https://firebasestorage.googleapis.com/v0/b/" +
  "impactdisciples-a82a8.appspot.com/o/EBooks%2FM-7-Journal.pdf" +
  "?alt=media&token=50e3282f-6fa1-46aa-ad3a-a486e4024af1";
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
function htmlToPlainText(html: string): string {
  return html
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
 * Queues one email document for the Trigger Email extension.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} to Recipient address.
 * @param {string} subject Subject line.
 * @param {string} html HTML body.
 * @return {Promise<string>} The queued mail doc id.
 */
export async function queueMail(
  db: FirebaseFirestore.Firestore,
  to: string,
  subject: string,
  html: string
): Promise<string> {
  const ref = await db.collection("mail").add({
    to,
    date: admin.firestore.Timestamp.now(),
    message: {subject, html, text: htmlToPlainText(html)},
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
export async function queueSubscriptionConfirmation(
  db: FirebaseFirestore.Firestore,
  type: string,
  firstName: string,
  email: string
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
      "<div>God Bless! - Impact Disciples Ministry</div>" + unsubscribe;
    await queueMail(db, email, subject, html);
    return;
  }

  const subject =
    "Thank you for Subscribing to the Impact Disciples Newletter!";
  const html =
    "<div>Dear " + escapeHtml(firstName) + ".</div><br><br>" +
    "<div>Your email address was successfully added to our Newletter " +
    "Subsciption List! (" + escapeHtml(email) + ")</div><br><br>" +
    "<div>Please accept this free <a href=\"" + FREE_EBOOK_URL +
    "\" download>EBook</a> as a small token of our appreciation." +
    "</div><br><br>" +
    "<div>God Bless! - Impact Disciples Ministry</div>" + unsubscribe;
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
 * @param {ReceiptCheckoutForm} form The saved checkout form.
 * @return {string} HTML table markup.
 */
function buildWebProductListHtml(form: ReceiptCheckoutForm): string {
  const items = form.cartItems ?? [];
  let ebooksPurchased = false;
  let subtotal = 0;
  let discountTotal = 0;

  let html = "<table style='width: 90%;'>";
  html += "<tr><td></td><td style='text-align: left;'>PRODUCT</td>" +
    "<td style='text-align: right;'>PRICE</td>" +
    "<td style='text-align: right;'>DISCOUNT</td>" +
    "<td style='text-align: center;'>QUANTITY</td>" +
    "<td style='text-align: right;'>TOTAL</td>" +
    "<td style='text-align: left;'></td></tr>";

  for (const item of items) {
    const unit = effectiveUnitPrice(item);
    const qty = item.orderQuantity ?? 0;
    const unitDiscount = typeof item.discount === "number" ?
      item.discount : 0;
    const lineTotal = (unit * qty) - (unitDiscount * qty);
    subtotal += unit * qty;
    discountTotal += unitDiscount * qty;

    html += "<tr>";
    html += "<td><img src='" + (item.img?.url ?? "") + "' alt='" +
      escapeHtml(item.img?.name ?? "") + "' height='100px'></img></td>";
    html += "<td style='text-align: left;'>" +
      escapeHtml(item.itemName ?? "") + "</td>";
    html += "<td style='text-align: right;'>" + usd.format(unit) + "</td>";
    html += unitDiscount > 0 ?
      "<td style='text-align: right;'>" + usd.format(unitDiscount) +
        "</td>" :
      "<td></td>";
    html += "<td style='text-align: center;'>" + qty + "</td>";
    html += "<td style='text-align: right;'>" + usd.format(lineTotal) +
      "</td>";
    if (item.isEBook) {
      html += "<td style='text-align: left;'><a href='" +
        (item.eBookUrl?.url ?? "") + "' download>DOWNLOAD</a></td>";
    }
    if (item.isDigitalBook) {
      ebooksPurchased = true;
      html += "<td style='text-align: left;'>See install instuctions " +
        "below!</td>";
    }
    html += "</tr>";
  }

  const taxes = form.estimatedTaxes ?? 0;
  const shipping = form.shippingRate ?? 0;
  const shippingDiscount = form.shippingDiscount ?? 0;
  const orderTotal =
    subtotal - discountTotal + taxes + shipping - shippingDiscount;

  html += "<tr><td></td><td></td><td></td><td></td><td>SUBTOTAL</td>" +
    "<td style='text-align: right;'><b>" + usd.format(subtotal) +
    "</b></td><td></td></tr>";
  if (taxes > 0) {
    html += "<tr><td></td><td></td><td></td><td></td><td>TAXES</td>" +
      "<td style='text-align: right;'><b> + " + usd.format(taxes) +
      "</b></td><td></td></tr>";
  }
  if (shipping > 0) {
    html += "<tr><td></td><td></td><td></td><td></td><td>SHIPPING</td>" +
      "<td style='text-align: right;'><b> + " + usd.format(shipping) +
      "</b></td><td></td></tr>";
  }
  if (shippingDiscount > 0) {
    html += "<tr><td></td><td></td><td></td><td></td>" +
      "<td>SHIPPING DISCOUNT</td>" +
      "<td style='text-align: right;'><b> - " +
      usd.format(shippingDiscount) + "</b></td><td></td></tr>";
  }
  if (discountTotal > 0) {
    html += "<tr><td></td><td></td><td></td><td></td><td>DISCOUNT</td>" +
      "<td style='text-align: right;'><b> - " + usd.format(discountTotal) +
      "</b></td><td></td></tr>";
  }
  html += "<tr><td></td><td></td><td></td><td></td><td>TOTAL</td>" +
    "<td style='text-align: right;'><b> = " + usd.format(orderTotal) +
    "</b></td><td></td></tr>";
  html += "</table>";

  if (form.receipt) {
    html += "<div>Confirmation Id: <b>" + escapeHtml(form.receipt) +
      "</b></div>";
  }
  if (ebooksPurchased) {
    html += "<br><div><b>If you purchased an item from our Digital " +
      "Library, instuctions for setting up the Library on your preferred " +
      "Device can be found <a href=\"" +
      "https://library.impactdisciples.com/install-instructions\">here" +
      "</a>!</b></div>";
    html += "<br><div>(For easy installation, it is best to open this " +
      "email on your preferred Device and click the link!)</div>";
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

  const templateSnap = await db.collection("mail_templates")
    .where("name", "==", "Sales Receipt").limit(1).get();
  if (!templateSnap.empty) {
    const template =
      templateSnap.docs[0].data() as {subject?: string; html?: string};
    // Buyer-supplied fields are HTML-escaped before substitution
    // (sweep 2026-08-17). product_list is builder-generated markup (its own
    // interpolations are already escaped), so it is inserted as-is.
    const model: Record<string, string> = {
      firstName: escapeHtml(form.firstName ?? ""),
      lastName: escapeHtml(form.lastName ?? ""),
      email: escapeHtml(email),
      product_list: buildWebProductListHtml(form),
    };
    let html = template.html ?? "";
    for (const [key, value] of Object.entries(model)) {
      html = html.split("{{" + key + "}}").join(value);
    }
    await queueMail(db, email, template.subject ?? "Sales Receipt", html);
  }

  const followUps = (form.cartItems ?? [])
    .filter((item) => !!item.followUpEmailId);
  for (const item of followUps) {
    const followUpSnap = await db.collection("mail_templates")
      .doc(item.followUpEmailId as string).get();
    if (!followUpSnap.exists) {
      continue;
    }
    const followUp = followUpSnap.data() as {subject?: string;
      html?: string};
    let html = followUp.html ?? "";
    const model: Record<string, string> = {
      firstName: escapeHtml(form.firstName ?? ""),
      lastName: escapeHtml(form.lastName ?? ""),
      email: escapeHtml(email.toLowerCase()),
    };
    for (const [key, value] of Object.entries(model)) {
      html = html.split("{{" + key + "}}").join(value);
    }
    await queueMail(db, email, followUp.subject ?? "", html);
  }
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
