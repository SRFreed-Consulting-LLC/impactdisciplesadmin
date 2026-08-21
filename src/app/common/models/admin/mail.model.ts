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
// Absent means 'system': every template that existed before the split was
// a system one (verified against dev and prod), so readers default rather
// than depend on the backfill having run - see
// scripts/backfill-template-kind.js.
export type MailTemplateKind = 'system' | 'campaign';

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
