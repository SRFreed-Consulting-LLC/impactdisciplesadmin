import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

export class MailTemplateModel extends BaseModel {
  name: string
  subject: string;
  html: string;
  attachments: unknown[];
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
