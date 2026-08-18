import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

export type TagRuleTrigger = 'purchase' | 'event-registration';

// One customer-tagging rule (Campaigns Manager > Tag Rules): "customer
// purchased <productId> => tag them <tag>" or "customer registered for
// <eventId> => tag them <tag>". Applied live by the customer-upsert Cloud
// Function triggers and retroactively by the applyTagRuleRetroactively
// callable - see functions/src/tag-rules.functions.ts. NOTE the event
// trigger means REGISTERED for (this system has no attended/check-in
// concept - EventRegistrationModel.loggedIn is never set true anywhere).
export class TagRuleModel extends BaseModel {
  name = '';
  trigger: TagRuleTrigger = 'purchase';
  // Exactly one of these is set, matching `trigger`; the other is null
  // (explicit null, never undefined - Firestore write gotcha).
  productId?: string | null = null;
  eventId?: string | null = null;
  // The tag applied to matching customers' tags[] array. Trimmed; '/' is
  // rejected at entry (the tag becomes part of a tag_applications doc id).
  tag = '';
  active = true;
  createdDate?: Timestamp | Date | null = null;
}
