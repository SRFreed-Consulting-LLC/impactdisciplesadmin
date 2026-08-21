import { FormBuilder } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
// The REAL default design, not a stub: persist() compiles it to html, and a
// hand-rolled shape silently fails that compile and makes every assertion
// here vacuous.
import { EmailDesign, createDefaultDesign } from 'src/app/common/models/admin/email-design.model';
import { CampaignEmailEditorComponent } from './campaign-email-editor.component';

// Hand-constructed with duck-typed deps, matching the house convention (see
// purchases.service.spec.ts).
//
// What this pins is the send/persist contract this component INHERITED from
// EmailTouchEditorComponent when designing and scheduling were merged onto
// one screen. That logic decides what actually goes out to real
// subscribers, and it moved between components without a test to catch a
// slip - so these are characterization tests for the behaviour as it stood
// in the touch editor, not a description of anything new:
//
//   - which `status` a save resolves to for each send mode,
//   - the exact shape of sendConfig (a scheduled date becomes a Timestamp;
//     the other two modes null out the fields they do not own),
//   - that html is recompiled from the design on every save, since the send
//     engine reads html and never the design,
//   - that validation refuses a send with a missing subject/date/tag rather
//     than persisting a half-configured email.
describe('CampaignEmailEditorComponent', () => {
  let component: CampaignEmailEditorComponent;
  let added: CampaignEmailModel[];
  let updated: { id: string; value: CampaignEmailModel }[];
  let errors: string[];
  let successes: string[];
  let design: EmailDesign;

  const build = (touch: CampaignEmailModel | null = null) => {
    added = [];
    updated = [];
    errors = [];
    successes = [];
    design = createDefaultDesign();

    const state = {
      design,
      dirty: false,
      viewMode: 'desktop',
      inlineEditing: false,
      canUndo: false,
      canRedo: false,
      load: () => undefined,
      deselect: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
    };
    const route = { snapshot: { paramMap: new Map<string, string>() } };
    const emailService = {
      add: (value: CampaignEmailModel) => {
        added.push(value);
        return Promise.resolve({ ...value, id: 'new-touch' });
      },
      update: (id: string, value: CampaignEmailModel) => {
        updated.push({ id, value });
        return Promise.resolve({ ...value, id });
      },
    };
    const snackbar = {
      error: (m: string) => errors.push(m),
      success: (m: string) => successes.push(m),
    };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const instance = new CampaignEmailEditorComponent(
      state as any,
      route as any,
      { navigate: () => Promise.resolve(true) } as any,
      {} as any,
      emailService as any,
      {} as any,
      { getAll: () => Promise.resolve([]) } as any,
      { canAdd: () => true, canEdit: () => true } as any,
      { dao: { loggedInUser$: { pipe: () => ({ subscribe: () => undefined }) } } } as any,
      {} as any,
      snackbar as any,
      {} as any,
      new FormBuilder()
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    instance.touch = touch;
    instance.campaign = { id: 'camp-1', name: 'Spring' } as never;
    // campaignId is private and normally comes from the route.
    (instance as unknown as { campaignId: string }).campaignId = 'camp-1';
    return instance;
  };

  describe('send mode "now"', () => {
    it('saves as a draft with both scheduling fields nulled out', async () => {
      component = build();
      component.form.patchValue({ subject: 'Hello', sendMode: 'now' });

      await component.saveDraft();

      expect(errors).toEqual([]);
      expect(added.length).toBe(1);
      expect(added[0].status).toBe('draft');
      expect(added[0].sendConfig?.mode).toBe('now');
      expect(added[0].sendConfig?.scheduledAt).toBeNull();
      expect(added[0].sendConfig?.tagTrigger).toBeNull();
    });

    it('recompiles html from the design - the send engine never reads design', async () => {
      component = build();
      component.form.patchValue({ subject: 'Hello' });

      await component.saveDraft();

      expect(typeof added[0].html).toBe('string');
      expect(added[0].html.length).toBeGreaterThan(0);
      expect(added[0].design).toBeTruthy();
    });

    it('carries the label through as null when left blank', async () => {
      component = build();
      component.form.patchValue({ subject: 'Hello', label: '' });

      await component.saveDraft();

      expect(added[0].label).toBeNull();
    });
  });

  describe('send mode "scheduled"', () => {
    it('resolves to status scheduled and converts the date to a Timestamp', async () => {
      component = build();
      component.form.patchValue({
        subject: 'Hello',
        sendMode: 'scheduled',
        scheduledAt: '2027-03-01T09:30',
      });

      await component.saveDraft();

      expect(added[0].status).toBe('scheduled');
      expect(added[0].sendConfig?.scheduledAt instanceof Timestamp).toBe(true);
      expect(added[0].sendConfig?.tagTrigger).toBeNull();
    });

    it('refuses to save without a date, and opens the schedule panel to say why', async () => {
      component = build();
      component.form.patchValue({ subject: 'Hello', sendMode: 'scheduled', scheduledAt: null });

      await component.saveDraft();

      expect(added.length).toBe(0);
      expect(component.scheduleOpen).toBe(true);
      expect(errors.length).toBe(1);
    });
  });

  describe('send mode "tagTriggered"', () => {
    it('stores the tags and delay, still as a draft until activated', async () => {
      component = build();
      component.form.patchValue({
        subject: 'Hello',
        sendMode: 'tagTriggered',
        triggerTags: ['Impact 1'],
        afterDays: 5,
      });

      await component.saveDraft();

      expect(added[0].status).toBe('draft');
      expect(added[0].sendConfig?.tagTrigger).toEqual({ tags: ['Impact 1'], afterDays: 5 });
      expect(added[0].sendConfig?.scheduledAt).toBeNull();
    });

    it('refuses to save with no trigger tag picked', async () => {
      component = build();
      component.form.patchValue({ subject: 'Hello', sendMode: 'tagTriggered', triggerTags: [] });

      await component.saveDraft();

      expect(added.length).toBe(0);
      expect(component.scheduleOpen).toBe(true);
    });
  });

  describe('validation', () => {
    it('refuses to save without a subject', async () => {
      component = build();
      component.form.patchValue({ subject: '' });

      await component.saveDraft();

      expect(added.length).toBe(0);
      expect(component.scheduleOpen).toBe(true);
    });
  });

  describe('editing an existing touch', () => {
    const existing = {
      id: 'touch-9',
      campaignId: 'camp-1',
      subject: 'Old',
      html: '<p>old</p>',
      status: 'draft',
      stats: { sent: 3, delivered: 3, opens: 1, uniqueOpens: 1, clicks: 0 },
      source: 'mailchimp',
      mailchimpCampaignId: 'mc_1',
      sentAt: null,
    } as unknown as CampaignEmailModel;

    it('updates in place rather than creating a second email', async () => {
      component = build(existing);
      component.form.patchValue({ subject: 'New' });

      await component.saveDraft();

      expect(added.length).toBe(0);
      expect(updated.length).toBe(1);
      expect(updated[0].id).toBe('touch-9');
      expect(updated[0].value.subject).toBe('New');
    });

    it('preserves the imported provenance and stats it must not invent', async () => {
      component = build(existing);
      component.form.patchValue({ subject: 'New' });

      await component.saveDraft();

      expect(updated[0].value.source).toBe('mailchimp');
      expect(updated[0].value.mailchimpCampaignId).toBe('mc_1');
      expect(updated[0].value.stats.sent).toBe(3);
    });
  });

  describe('statusLabel', () => {
    it('reads as unsaved for a brand-new email', () => {
      component = build();
      expect(component.statusLabel).toBe('New · not saved');
    });

    it('calls out an automated email so the chip is not just "Draft"', () => {
      component = build();
      component.form.patchValue({ sendMode: 'tagTriggered' });
      expect(component.statusLabel).toBe('Draft · automated');
    });
  });
});
