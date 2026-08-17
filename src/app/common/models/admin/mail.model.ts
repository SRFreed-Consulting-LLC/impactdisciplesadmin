import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';
import { EmailDesign } from './email-design.model';

export class MailTemplateModel extends BaseModel {
  name: string
  subject: string;
  // ALWAYS the compiled, sendable output. For builder templates (design
  // present) it is re-derived from `design` on every save; for legacy Quill
  // templates it is the authored content itself. Send paths only read this.
  html: string;
  attachments: unknown[];
  // Present ⇔ the template was authored in the Email Builder (Tools Manager >
  // Email Templates > New Email Design). Absent on legacy Quill templates.
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
