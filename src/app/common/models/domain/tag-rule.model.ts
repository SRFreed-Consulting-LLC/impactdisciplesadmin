import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '@impact-common/shared/models/base.model';

export type TagRuleTrigger = 'purchase' | 'event-registration' | 'summit-registration';

// One customer-tagging rule (Campaigns Manager > Tag Rules): "customer
// purchased any of <productIds> => tag them <tag>", "customer registered
// for any of <eventIds> => tag them <tag>", or the summit shape: "customer
// registered for ANY isSummit event => tag them <paidTag> if they paid,
// <tag> if their registration was free" (paid-ness = the registration's
// receipt is a payment id rather than a coupon code - the free checkout
// path stores the coupon code as the receipt). Applied live by the
// customer-upsert Cloud Function triggers and retroactively by the
// applyTagRuleRetroactively callable - see
// functions/src/tag-rules.functions.ts (the matcher of record; keep this
// model aligned with its TagRuleDoc). NOTE the event triggers mean
// REGISTERED for (this system has no attended/check-in concept -
// EventRegistrationModel.loggedIn is never set true anywhere).
export class TagRuleModel extends BaseModel {
  name = '';
  trigger: TagRuleTrigger = 'purchase';
  // Legacy single-target shapes - superseded by productIds/eventIds but
  // still honored by the matcher for rules saved before 2026-08-20.
  productId?: string | null = null;
  eventId?: string | null = null;
  // Multi-target shapes: a purchase rule matches when ANY of its products
  // is in the cart; an event rule when the registration's event is in the
  // list. Explicit null when not applicable (Firestore write gotcha).
  productIds?: string[] | null = null;
  eventIds?: string[] | null = null;
  // The tag applied to matching customers' tags[] array; for
  // summit-registration rules this is the FREE-registration tag. Trimmed;
  // '/' is rejected at entry (the tag becomes part of a tag_applications
  // doc id).
  tag = '';
  // summit-registration rules only: the tag applied to PAID registrations
  // (every summit registrant gets exactly one of tag/paidTag).
  paidTag?: string | null = null;
  active = true;
  createdDate?: Timestamp | Date | null = null;
}
