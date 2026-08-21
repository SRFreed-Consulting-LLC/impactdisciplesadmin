import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { EmailTemplatesComponent } from './email-templates.component';

// Hand-constructed with duck-typed deps, matching the house convention.
//
// This pins WHICH EDITOR OPENS, which has regressed once already: between
// 2026-08-17 and 2026-08-21 every template - legacy Quill ones included -
// opened in the full-screen builder, which imported them as a single text
// block and converted them to builder templates on the first save. On a
// system template that is a hazard, because these are placeholder
// documents a Cloud Function substitutes into, so a typo fix should never
// restructure the markup. Getting this wrong is silent, hence the test.
describe('EmailTemplatesComponent', () => {
  let component: EmailTemplatesComponent;
  let navigated: unknown[][];
  let dialogsOpened: { data: unknown }[];
  let confirmAnswer: boolean;

  const richText = { id: 'rt-1', name: 'Sales Receipt', subject: 'Receipt', html: '<p>hi</p>' } as MailTemplateModel;
  const builder = { id: 'b-1', name: 'Promo', subject: 'Promo', html: '<p>hi</p>', design: { sections: [] } } as unknown as MailTemplateModel;

  const build = (canEdit = true, canDelete = true) => {
    navigated = [];
    dialogsOpened = [];
    confirmAnswer = true;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new EmailTemplatesComponent(
      { streamAll: () => ({ pipe: () => ({}) }) } as any,
      { canAdd: () => true, canEdit: () => canEdit, canDelete: () => canDelete } as any,
      { open: (_c: unknown, config: { data: unknown }) => { dialogsOpened.push(config); return { afterClosed: () => ({ subscribe: () => undefined }) }; } } as any,
      { confirm: () => Promise.resolve(confirmAnswer) } as any,
      { success: () => undefined, error: () => undefined } as any,
      { navigate: (commands: unknown[]) => { navigated.push(commands); return Promise.resolve(true); } } as any
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };

  describe('showEditModal', () => {
    it('opens the Quill dialog for a rich-text template', () => {
      component = build();
      component.showEditModal(richText);

      expect(navigated).toEqual([]);
      expect(dialogsOpened.length).toBe(1);
      expect((dialogsOpened[0].data as { item: MailTemplateModel }).item).toBe(richText);
    });

    it('opens the full-screen builder for a builder template', () => {
      component = build();
      component.showEditModal(builder);

      expect(dialogsOpened).toEqual([]);
      expect(navigated).toEqual([['/tools-manager/email-designer', 'b-1']]);
    });

    it('does nothing without the edit grant', () => {
      component = build(false);
      component.showEditModal(richText);
      component.showEditModal(builder);

      expect(navigated).toEqual([]);
      expect(dialogsOpened).toEqual([]);
    });
  });

  describe('openInBuilder', () => {
    it('converts only after the user confirms', async () => {
      component = build();
      await component.openInBuilder(richText);

      expect(navigated).toEqual([['/tools-manager/email-designer', 'rt-1']]);
    });

    it('does not navigate when the user declines', async () => {
      component = build();
      confirmAnswer = false;
      await component.openInBuilder(richText);

      expect(navigated).toEqual([]);
    });
  });

  describe('row actions', () => {
    it('offers the builder conversion only on rich-text templates', () => {
      component = build();
      const convert = component.rowActions.find((a) => a.icon === 'brush')!;

      expect(convert.visible!(richText)).toBe(true);
      expect(convert.visible!(builder)).toBe(false);
    });

    it('hides the conversion without the edit grant', () => {
      component = build(false);
      const convert = component.rowActions.find((a) => a.icon === 'brush')!;

      expect(convert.visible!(richText)).toBe(false);
    });
  });

  describe('Editor column', () => {
    const editorValue = (item: MailTemplateModel) => {
      const column = build().columns.find((c) => c.key === 'editorType')!;
      return column.value!(item);
    };

    it('labels a design-bearing template as Email Builder', () => {
      expect(editorValue(builder)).toBe('Email Builder');
    });

    it('labels a design-less template as Rich Text', () => {
      expect(editorValue(richText)).toBe('Rich Text');
    });
  });
});
