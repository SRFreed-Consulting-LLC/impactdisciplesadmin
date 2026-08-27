import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { EmailDesign } from './email-design.model';

// Which list a template belongs to (2026-08-21). SYSTEM templates are the
// ones the app itself sends from - order receipts, event confirmations,
// product follow-ups - looked up by name or id from Cloud Functions, and
// managed on Tools Manager > System Templates. CAMPAIGN templates are
// marketing starting points, created only by the campaign email editor's
// "Save as template" and offered only in that editor's gallery.
//
// Every other kind NAMES THE SCREEN THAT OWNS THE TEMPLATE (2026-08-27) - the
// one place an admin edits it, right beside the button that sends it. These
// exist to be migrated into, one template at a time: as each gains an editor
// in context it takes that screen's kind and leaves the System Templates list,
// and when the list empties the screen goes with it.
//
// Named per screen rather than a single flat 'contextual' on purpose: there
// will be several, and "which screen owns this email" is the question someone
// actually asks. A flat marker would answer only "not in the list any more",
// which is the least useful half of it.
//
//   'fulfillment' - Contacts Manager > Fulfillment. The Amazon Shipping
//                   Confirmation, sent when an order ships via Amazon.
//   'product'     - Store Manager > Products. The follow-up email a product
//                   sends after purchase, picked from that screen's "Select
//                   Email" list and created from it too. Unlike the others
//                   this kind is also a FILTER: the picker offers exactly the
//                   templates carrying it, so the kind decides what an admin
//                   can choose, not only where they find it.
//   'event'       - Events Manager > Events. The registration confirmation an
//                   event sends, picked from the event form's "Email
//                   Template" list. Also a filter, same as 'product' - that
//                   list used to offer every template in the collection,
//                   including a product follow-up and the Amazon shipping
//                   notice.
//   'store'       - Contacts Manager > Purchases. The Sales Receipt, sent by
//                   the checkout Cloud Function for every web order. Not a
//                   filter (nothing picks it from a list) - it is resolved by
//                   the literal name "Sales Receipt", so this kind only says
//                   where an admin edits it: beside the order totals on a
//                   purchase, which is the one screen showing what it sent.
//   'summit'      - Events Manager > Summit, and the New Summit wizard. Kept
//                   APART from 'event' even though a summit is an event and
//                   shares its form: a summit confirmation talks about
//                   breakout sessions and a weekend programme, and a regular
//                   event's does not, so offering either list to the other
//                   screen only invites picking the wrong one.
//
// Add a kind here as its screen grows an editor. Nothing sends by kind - send
// paths resolve a template by NAME or by DOC ID - so a template's kind decides
// where an admin FINDS it and nothing else.
export type MailTemplateKind =
  'system' | 'campaign' | 'fulfillment' | 'product' | 'event' | 'summit' | 'store';

/** The kinds that mean "owned by a screen", i.e. not in the generic list. */
export const TEMPLATE_HOME_KINDS = [
  'fulfillment', 'product', 'event', 'summit', 'store'
] as const satisfies readonly MailTemplateKind[];

export class MailTemplateModel extends BaseModel {
  name: string
  subject: string;
  kind?: MailTemplateKind;
  // ALWAYS the compiled, sendable output. For builder templates (design
  // present) it is re-derived from `design` on every save; for legacy Quill
  // templates it is the authored content itself. Send paths only read this.
  html: string;
  attachments: unknown[];
  // Present ⇔ the template was authored in the Email Builder (Tools Manager >
  // System Templates > New Email Design). Absent on legacy Quill templates.
  design?: EmailDesign;
}

export class EMailModel extends BaseModel {
  date: Timestamp;
  to: string;
  message?: MessageModel;
  template?: TemplateModel
  // Written by a downstream email-delivery webhook/Cloud Function trigger
  // after the message is sent, not present at creation time.
  delivery?: { state: string; endTime: unknown };
}

export class MessageModel{
  subject: string;
  text?: string;
  html?: string;
}

export class TemplateModel {
  name: string
  // Dynamic template data consumed by the "Trigger Email" Firestore
  // extension (not a serialized string despite the field's original typing -
  // that only compiled before because every caller passed it as `any`) -
  // an arbitrary bag of {{variable}} substitution values.
  data: Record<string, unknown>;
}
