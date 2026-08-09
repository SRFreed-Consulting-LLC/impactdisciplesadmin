import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

export class MailTemplateModel extends BaseModel {
  name: string
  subject: string;
  html: string;
  attachments: any[];
}

export class EMailModel extends BaseModel {
  date: Timestamp;
  to: string;
  message?: MessageModel;
  template?: TemplateModel
}

export class MessageModel{
  subject: string;
  text?: string;
  html?: string;
}

export class TemplateModel {
  name: string
  data: string;
}
