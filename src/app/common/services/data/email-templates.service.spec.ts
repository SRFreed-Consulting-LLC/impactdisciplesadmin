import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EMailTemplatesService, kindOf } from './email-templates.service';

// Hand-constructed with a duck-typed DAO, matching the house convention
// (see permission.service.spec.ts / purchases.service.spec.ts).
//
// The behaviour worth pinning here is the DEFAULT: `mail_templates` docs
// written before the system/campaign split carry no `kind` at all, and both
// lists depend on those counting as system. Getting that backwards would
// quietly drop every real transactional template out of Tools Manager >
// System Templates and leak them into the campaign gallery.
describe('EMailTemplatesService', () => {
  const template = (over: Partial<MailTemplateModel>): MailTemplateModel =>
    ({ name: 'T', subject: 'S', html: '', attachments: [], ...over } as MailTemplateModel);

  describe('kindOf', () => {
    it('reads a doc with no kind as system - the pre-split default', () => {
      expect(kindOf(template({}))).toBe('system');
    });

    it('reads an explicit system kind as system', () => {
      expect(kindOf(template({ kind: 'system' }))).toBe('system');
    });

    it('reads a campaign kind as campaign', () => {
      expect(kindOf(template({ kind: 'campaign' }))).toBe('campaign');
    });

    it('treats an unrecognised value as system rather than hiding the doc', () => {
      expect(kindOf(template({ kind: 'nonsense' as never }))).toBe('system');
    });
  });

  describe('getAllOfKind', () => {
    let service: EMailTemplatesService;

    const build = (templates: MailTemplateModel[]) => {
      const dao = { getAll: () => Promise.resolve(templates) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new EMailTemplatesService(dao as any);
    };

    it('returns pre-split (kind-less) templates as system', async () => {
      service = build([
        template({ name: 'Sales Receipt' }),
        template({ name: 'Promo', kind: 'campaign' }),
      ]);

      const system = await service.getAllOfKind('system');
      expect(system.map((t) => t.name)).toEqual(['Sales Receipt']);
    });

    it('returns only campaign templates for the campaign gallery', async () => {
      service = build([
        template({ name: 'Sales Receipt' }),
        template({ name: 'Summit Confirmation', kind: 'system' }),
        template({ name: 'Promo', kind: 'campaign' }),
        template({ name: 'Spring Sale', kind: 'campaign' }),
      ]);

      const campaign = await service.getAllOfKind('campaign');
      expect(campaign.map((t) => t.name)).toEqual(['Promo', 'Spring Sale']);
    });

    it('returns an empty list rather than everything when no doc matches', async () => {
      service = build([template({ name: 'Sales Receipt' })]);

      expect(await service.getAllOfKind('campaign')).toEqual([]);
    });
  });
});
