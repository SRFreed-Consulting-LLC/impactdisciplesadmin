import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { EMailModel, MessageModel, TemplateModel } from 'src/app/common/models/admin/mail.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { EMailTemplatesService } from './email-templates.service';

@Injectable({
  providedIn: 'root'
})
export class EMailService extends BaseService<EMailModel>{
  constructor(public override dao: FirebaseDAO<EMailModel>, public templateService: EMailTemplatesService) {
    super(dao)
    this.table="mail"
    this.fromFirestore = EMailService.fromFirestore
  }

  static readonly fromFirestore = (data): EMailModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  sendHtmlEmail(to:string, subject: string, html: string): Promise<EMailModel>{
    let mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    let mailMessage: MessageModel = {... new MessageModel()};

    mailMessage.subject = subject;
    mailMessage.html = html;

    mail.message = mailMessage;

    return this.add(mail);
  }

  sendTextEmail(to:string, subject: string, text: string): Promise<EMailModel>{
    let mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    let mailMessage: MessageModel = {... new MessageModel()};
    mailMessage.subject = subject;
    mailMessage.text = text;

    mail.message = mailMessage;

    return this.add(mail);
  }

  sendTemplateEmail(to:string, templateId: string, model: any): Promise<EMailModel>{
    let mail = {... new EMailModel()}
    mail.to = to;
    mail.date = Timestamp.now();

    let mailTemplate = {... new TemplateModel()};
    mailTemplate.name = templateId;
    mailTemplate.data = model;

    mail.template = mailTemplate;

    return this.add(mail);
  }

  sendHTMLEMailFromTemplate(to:string, templateId: string, model: any){
    return this.templateService.getAllByValue('name', templateId).then(template => {
      let mail = {... new EMailModel()}
      mail.to = to;
      mail.date = Timestamp.now();

      let html = template[0].html;

      Object.entries(model).forEach(([key, value]) => {
        html = html.replace("{{"+key+"}}", model[key])
      });

      let mailMessage: MessageModel = {... new MessageModel()};

      mailMessage.subject = template[0].subject.replace("{{eventName}}", model.eventName);
      mailMessage.html = html;

      mail.message = mailMessage;

      return this.add(mail);
    })
  }

  sendHTMLEMailByIdFromTemplate(to:string, templateId: string, model: any){
    return this.templateService.getById(templateId).then(template => {
      let mail = {... new EMailModel()}
      mail.to = to;
      mail.date = Timestamp.now();

      let html = template.html;

      Object.entries(model).forEach(([key, value]) => {
        console.log('checking for ' + [key])
        html = html.replace("{{"+key+"}}", model[key])
      });

      let mailMessage: MessageModel = {... new MessageModel()};

      mailMessage.subject = template.subject;
      mailMessage.html = html;

      mail.message = mailMessage;

      return this.add(mail);
    })
  }
}
