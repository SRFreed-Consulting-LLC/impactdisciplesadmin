import {tenantPath} from "../common/shared/lists/tenancy";
const TEMPLATES = tenantPath("mail_templates");
// The two mail_templates that no DATA points at - the send paths name them
// in code - and how to find them without depending on their name.
//
// The problem this solves: queueWebOrderEmails and PurchasesService used to
// resolve these with where("name", "==", "Sales Receipt"). A template's name
// is an ordinary text field an admin can edit, so renaming one stopped a
// receipt with no error anywhere, and nothing on the editing screen hinted
// at it. Every other template is bound by something the data owns (an event's
// emailTemplate, a product's followUpEmailId); these two had only a label.
//
// A document id cannot be edited, so it is the right handle - but the ids
// these documents were CREATED with are not the same on both projects
// (Amazon Shipping Confirmation was seeded per project, so dev and prod each
// got a random one). Firestore cannot rename a document, so the fix is to
// re-create them under ids that are known, meaningful and identical
// everywhere: scripts/pin-template-ids.js does that, once per project.
//
// The lookup still falls back to the name, LOUDLY, so the order of a deploy
// can never break a receipt: a project whose data has not been pinned yet
// keeps sending and says so in the log.

export const MAIL_TEMPLATE_IDS = {
  salesReceipt: "tmpl-sales-receipt",
  amazonShippingConfirmation: "tmpl-amazon-shipping-confirmation",
} as const;

export interface ResolvedTemplate {
  id: string;
  data: {subject?: string; html?: string};
}

/**
 * Finds a code-owned template by its pinned id, falling back to its name.
 *
 * Returns null when neither finds exactly one document - the caller decides
 * what to say about it, because "no receipt was sent" and "no shipping
 * confirmation was sent" need different messages.
 * @param {FirebaseFirestore.Firestore} db Firestore handle.
 * @param {string} id The pinned document id (MAIL_TEMPLATE_IDS).
 * @param {string} name The legacy name to fall back to.
 * @return {Promise<ResolvedTemplate | null>} The template, or null.
 */
export async function resolveCodeTemplate(
  db: FirebaseFirestore.Firestore,
  id: string,
  name: string
): Promise<ResolvedTemplate | null> {
  const byId = await db.collection(TEMPLATES).doc(id).get();
  if (byId.exists) {
    return {id: byId.id, data: byId.data() as ResolvedTemplate["data"]};
  }

  const byName = await db.collection(TEMPLATES)
    .where("name", "==", name).get();

  if (byName.empty) {
    return null;
  }
  if (byName.size > 1) {
    // Deliberately NOT picking one: an admin could edit the template they
    // can see and still have customers receive the other copy.
    console.error(
      `${byName.size} mail_templates are named "${name}" ` +
      `(${byName.docs.map((d) => d.id).join(", ")}) and none carries the ` +
      `pinned id ${id}. Refusing to guess which one is real.`
    );
    return null;
  }

  console.error(
    `mail_template "${name}" was found by NAME, not by its pinned id ${id}. ` +
    "Renaming it will silently stop this email - run " +
    "scripts/pin-template-ids.js against this project."
  );
  const found = byName.docs[0];
  return {id: found.id, data: found.data() as ResolvedTemplate["data"]};
}
