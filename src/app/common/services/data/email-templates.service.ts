import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { MailTemplateModel, MailTemplateKind } from 'src/app/common/models/admin/mail.model';
import { BaseService } from './base.service';

// One collection, two lists (2026-08-21): `mail_templates` holds both the
// SYSTEM templates the app sends from (receipts, event confirmations,
// product follow-ups - resolved by name or id inside Cloud Functions) and
// the CAMPAIGN templates the campaign email editor offers as starting
// points. They are kept apart by the `kind` field rather than a second
// collection so both lists keep sharing one service, one designer, and one
// firestore.rules entry - see MailTemplateModel's own comment.
@Injectable({
  providedIn: 'root'
})
export class EMailTemplatesService extends BaseService<MailTemplateModel> {
  constructor(public override dao: FirebaseDAO<MailTemplateModel>) {
    super(dao)
    this.table="mail_templates"
  }

  /** Templates of one kind. Docs written before the split carry no `kind`
   *  at all and count as 'system' - the filter is applied in memory for
   *  exactly that reason: a Firestore where('kind','==','system') would
   *  silently drop every one of them (Firestore only matches documents
   *  that HAVE the field). */
  async getAllOfKind(kind: MailTemplateKind): Promise<MailTemplateModel[]> {
    const all = await this.getAll();
    return all.filter((template) => kindOf(template) === kind);
  }
}

/**
 * A template's list, defaulting an absent `kind` to 'system'.
 *
 * Written as an allow-list rather than `template.kind ?? 'system'` on purpose:
 * an unrecognised value in the data - a typo, or a kind added by a newer
 * build - lands a template back in System Templates, where somebody will see
 * it. The alternative fails the other way, hiding a template from every list
 * at once with nothing to notice it by.
 */
export function kindOf(template: MailTemplateModel): MailTemplateKind {
  if (template.kind === 'campaign') return 'campaign';
  if (template.kind === 'contextual') return 'contextual';
  return 'system';
}
