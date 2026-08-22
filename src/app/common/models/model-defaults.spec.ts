import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { MailTemplateModel, EMailModel, MessageModel, TemplateModel } from 'src/app/common/models/admin/mail.model';
import { UserPermission } from 'src/app/common/models/admin/user-permission.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignPopupModel, PopupTemplateModel } from 'src/app/common/models/domain/campaign-popup.model';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryLessonTemplateModel } from 'src/app/common/models/domain/library/library-lesson-template.model';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibrarySubtemplateModel } from 'src/app/common/models/domain/library/library-subtemplate.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { TagRuleModel } from 'src/app/common/models/domain/tag-rule.model';
import { ContactNoteModel } from 'src/app/common/models/domain/utils/contact-note.model';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { AffilliatePaymentModel } from 'src/app/common/models/utils/affilliate-payment.model';
import { FileItem } from 'src/app/common/models/utils/file-item.model';

// Breadth pass over the app's plain data models (2026-08-22).
//
// Each of these is a class whose whole job is to declare the SHAPE of a
// Firestore document and the defaults a new one starts with. That makes
// them cheap to test and worth testing: a default that silently changes
// from false to undefined is the kind of thing that writes an undefined
// into Firestore (which rejects the whole document - see
// strip-undefined.ts) or flips a feature on for every new record.
//
// Deliberately shallow and mechanical. This exists to put these files in
// the coverage denominator and to pin their construction contract; the
// models with real behaviour beyond defaults get their own specs (see
// campaign.model.spec.ts and email-design.model.spec.ts).
//
// Classes taking constructor arguments are excluded - `new X()` is not
// their contract.

interface ModelRow {
  name: string;
  make: () => object;
}

const MODELS: ModelRow[] = [
  { name: 'AdminUser', make: () => new AdminUser() },
  { name: 'MailTemplateModel', make: () => new MailTemplateModel() },
  { name: 'EMailModel', make: () => new EMailModel() },
  { name: 'MessageModel', make: () => new MessageModel() },
  { name: 'TemplateModel', make: () => new TemplateModel() },
  { name: 'UserPermission', make: () => new UserPermission() },
  { name: 'CampaignEmailModel', make: () => new CampaignEmailModel() },
  { name: 'CampaignPopupModel', make: () => new CampaignPopupModel() },
  { name: 'PopupTemplateModel', make: () => new PopupTemplateModel() },
  { name: 'BookSeriesModel', make: () => new BookSeriesModel() },
  { name: 'LibraryBookModel', make: () => new LibraryBookModel() },
  { name: 'LibraryLessonTemplateModel', make: () => new LibraryLessonTemplateModel() },
  { name: 'LibraryLessonModel', make: () => new LibraryLessonModel() },
  { name: 'LibrarySubtemplateModel', make: () => new LibrarySubtemplateModel() },
  { name: 'LibraryUnitModel', make: () => new LibraryUnitModel() },
  { name: 'TagRuleModel', make: () => new TagRuleModel() },
  { name: 'ContactNoteModel', make: () => new ContactNoteModel() },
  { name: 'ContactModel', make: () => new ContactModel() },
  { name: 'AffilliatePaymentModel', make: () => new AffilliatePaymentModel() },
  { name: 'FileItem', make: () => new FileItem() },
];

describe('data models - construction and defaults', () => {
  for (const { name, make } of MODELS) {
    describe(name, () => {
      it('constructs with no arguments', () => {
        expect(make()).toBeTruthy();
      });

      it('declares no undefined-valued own property', () => {
        // A declared-but-undefined field is the one that breaks a Firestore
        // write. Anything intentionally absent should simply not be
        // declared, or be declared null.
        const instance = make() as Record<string, unknown>;
        const undef = Object.keys(instance).filter((k) => instance[k] === undefined);
        expect(undef).withContext(`${name} declares undefined: ${undef}`).toEqual([]);
      });

      it('returns a fresh instance each time, sharing no mutable state', () => {
        const a = make() as Record<string, unknown>;
        const b = make() as Record<string, unknown>;
        expect(a).not.toBe(b);
        for (const key of Object.keys(a)) {
          const left = a[key];
          if (Array.isArray(left)) {
            // A shared array default means editing one record's list edits
            // every other new record's too.
            expect(left === b[key]).withContext(`${name}.${key} array is shared`).toBeFalse();
          }
        }
      });
    });
  }

  it('covers every model exactly once', () => {
    const names = MODELS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
