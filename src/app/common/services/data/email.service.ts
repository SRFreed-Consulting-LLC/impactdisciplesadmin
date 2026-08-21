import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { EMailModel, MessageModel, TemplateModel } from 'src/app/common/models/admin/mail.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { htmlToPlainText } from '@impact-common/shared/utils/html-to-text';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class EMailService extends BaseService<EMailModel>{
  constructor(public override dao: FirebaseDAO<EMailModel>) {
    super(dao)
    this.table="mail"
    this.fromFirestore = EMailService.fromFirestore
  }

  static readonly fromFirestore = (data): EMailModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  sendHtmlEmail(to:string, subject: string, html: string): Promise<EMailModel>{
    const mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    const mailMessage: MessageModel = {... new MessageModel()};

    mailMessage.subject = subject;
    mailMessage.html = html;
    mailMessage.text = htmlToPlainText(html);

    mail.message = mailMessage;

    return this.add(mail);
  }

  sendTextEmail(to:string, subject: string, text: string): Promise<EMailModel>{
    const mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    const mailMessage: MessageModel = {... new MessageModel()};
    mailMessage.subject = subject;
    mailMessage.text = text;

    mail.message = mailMessage;

    return this.add(mail);
  }

  sendTemplateEmail(to:string, templateId: string, model: Record<string, unknown>): Promise<EMailModel>{
    const mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    const mailTemplate = {... new TemplateModel()};
    mailTemplate.name = templateId;
    mailTemplate.data = model;

    mail.template = mailTemplate;

    return this.add(mail);
  }

  // NOTE: the old sendHTMLEMailFromTemplate/sendHTMLEMailByIdFromTemplate
  // methods (client-side template substitution) were removed 2026-08-17 -
  // they had no callers and their String.replace() substitution only hit
  // the first occurrence of each token. Template substitution now goes
  // through renderMergeTags() (src/app/common/utils/email/merge-tags.ts).
}
