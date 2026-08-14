import { BaseModel } from "../base.model";

// Singleton settings doc (integration_settings/mailchimp, fixed id - see
// MailchimpConfigService) read live by functions/src/mailchimp-sync.
// functions.ts on every customers create/update and by the purchase/event-
// registration upsert triggers (for source tagging). Deliberately excludes
// the Mailchimp API key itself - firestore.rules is wide open, so anything
// stored here is effectively public; the key stays in Firebase Secret
// Manager (MAILCHIMP_API_KEY), never in this doc.
export class MailchimpConfigModel extends BaseModel {
  // Master switch - every sync/tag call in mailchimp-sync.functions.ts
  // no-ops while this is false.
  enabled: boolean;
  audienceId: string;
  // Mailchimp API keys are formatted "<key>-usXX" - left blank, the
  // datacenter is parsed off that suffix at call time instead.
  serverPrefix?: string;
  // Applied only to brand-new Mailchimp members (Mailchimp's
  // status_if_new) - never overwrites an existing member's status, so
  // someone who unsubscribed/complained in Mailchimp stays that way
  // regardless of what this app later syncs.
  defaultSubscribeStatus: 'pending' | 'subscribed' | 'transactional';
  enableSourceTags: boolean;
  purchaseTag: string;
  eventRegistrationTag: string;
}
