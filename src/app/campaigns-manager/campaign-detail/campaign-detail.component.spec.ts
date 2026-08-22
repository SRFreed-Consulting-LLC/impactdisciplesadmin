import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignModel, emptyCampaignStats, emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { CampaignPopupService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { CampaignDetailComponent } from './campaign-detail.component';

// TestBed as an INJECTOR only - nothing renders, so this resolves
// constructor params and `inject()` fields alike and survives the file's
// later conversion to `inject()`.
//
// What is worth pinning here is POLICY, not plumbing. Which emails may be
// deleted, which may be published to the public site, and what the funnel
// shows for a campaign that has no email channel are all decisions someone
// made deliberately - and every one of them is a rule a future edit could
// quietly widen.

type Perms = Partial<Record<'canAdd' | 'canEdit' | 'canDelete', boolean>>;

function setup(perms: Perms = { canAdd: true, canEdit: true, canDelete: true }) {
  const navigated: unknown[][] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      CampaignDetailComponent,
      { provide: CampaignEmailService, useValue: { getPage: () => Promise.resolve({ items: [], cursor: null, hasMore: false }) } },
      { provide: CampaignService, useValue: {} },
      { provide: CampaignPopupService, useValue: { getById: () => Promise.resolve(null) } },
      { provide: ProductService, useValue: { getById: () => Promise.resolve(null) } },
      { provide: EventService, useValue: { getById: () => Promise.resolve(null) } },
      {
        provide: PermissionService,
        useValue: {
          canAdd: () => perms.canAdd ?? true,
          canEdit: () => perms.canEdit ?? true,
          canDelete: () => perms.canDelete ?? true,
        },
      },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined } },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }) }) } },
      { provide: Router, useValue: { navigate: (...args: unknown[]) => { navigated.push(args); return Promise.resolve(true); } } },
    ],
  });
  const component = TestBed.inject(CampaignDetailComponent);
  return { component, navigated };
}

function campaign(over: Partial<CampaignModel> = {}): CampaignModel {
  return { id: 'camp-1', name: 'Test', stats: emptyCampaignStats(), channels: ['email'], ...over } as CampaignModel;
}

function touch(over: Partial<CampaignEmailModel> = {}): CampaignEmailModel {
  return {
    id: 't1',
    campaignId: 'camp-1',
    stats: emptyEmailStats(),
    ...over,
  } as CampaignEmailModel;
}

describe('CampaignDetailComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('funnel', () => {
    it('shows the email stages for an email campaign', () => {
      const { component } = setup();
      component.campaign = campaign({ channels: ['email'] });
      expect(component.funnel.map((t) => t.label))
        .toEqual(['Sent', 'Delivered', 'Opened', 'Clicked', 'Purchased']);
    });

    it('shows popup stages instead for a web-only campaign', () => {
      // A web-only campaign never sends an email, so email stages would be
      // permanently zero and read as failure rather than absence.
      const { component } = setup();
      component.campaign = campaign({ channels: ['web'] });
      expect(component.funnel.map((t) => t.label))
        .toEqual(['Popup Shown', 'Popup Clicked', 'Purchased']);
    });

    it('shows both when a campaign runs email and web', () => {
      const { component } = setup();
      component.campaign = campaign({ channels: ['email', 'web'] });
      const labels = component.funnel.map((t) => t.label);
      expect(labels).toContain('Sent');
      expect(labels).toContain('Popup Shown');
    });

    it('always ends on Purchased, whatever the channels', () => {
      const { component } = setup();
      component.campaign = campaign({ channels: [] });
      expect(component.funnel[component.funnel.length - 1].label).toBe('Purchased');
    });

    it('distinguishes "nothing yet" from zero for delivered and purchased', () => {
      // An em dash plus "not tracked yet" says the number is unknown; a
      // literal 0 would claim it was measured and came back empty.
      const { component } = setup();
      component.campaign = campaign();
      const byLabel = new Map(component.funnel.map((t) => [t.label, t]));
      expect(byLabel.get('Delivered')!.value).toBe('—');
      expect(byLabel.get('Delivered')!.sub).toBe('not tracked yet');
      expect(byLabel.get('Purchased')!.value).toBe('—');
    });

    it('computes percentages against sent, and omits them when nothing was sent', () => {
      const { component } = setup();
      const stats = { ...emptyCampaignStats(), sent: 200, delivered: 180, uniqueOpens: 50, clicks: 20 };
      component.campaign = campaign({ stats });
      const byLabel = new Map(component.funnel.map((t) => [t.label, t]));
      expect(byLabel.get('Delivered')!.sub).toBe('90%');
      expect(byLabel.get('Clicked')!.sub).toBe('10%');
      expect(byLabel.get('Opened')!.sub).toContain('25%');
    });

    it('marks the open rate approximate, since open tracking undercounts', () => {
      const { component } = setup();
      component.campaign = campaign({ stats: { ...emptyCampaignStats(), sent: 100, uniqueOpens: 40 } });
      const opened = component.funnel.find((t) => t.label === 'Opened');
      expect(opened!.sub).toContain('approx.');
    });

    it('shows revenue against purchases once there are any', () => {
      const { component } = setup();
      component.campaign = campaign({ stats: { ...emptyCampaignStats(), sent: 10, purchases: 3, revenue: 1234.6 } });
      const purchased = component.funnel.find((t) => t.label === 'Purchased');
      expect(purchased!.value).toBe('3');
      expect(purchased!.sub).toBe('$1,235');
    });
  });

  describe('touchOpenRate', () => {
    it('is a whole percentage of that touch\'s own sends', () => {
      const { component } = setup();
      expect(component.touchOpenRate(touch({ stats: { ...emptyEmailStats(), sent: 200, uniqueOpens: 50 } })))
        .toBe('25%');
    });

    it('is blank rather than a divide-by-zero when nothing was sent', () => {
      const { component } = setup();
      expect(component.touchOpenRate(touch())).toBe('');
    });
  });

  describe('what may be edited or deleted', () => {
    it('allows editing and deleting only unsent emails', () => {
      // "Not sent" is the real criterion: a scheduled touch is just one the
      // hourly scheduler has not reached, and deleting it is how a planned
      // send gets called off.
      const { component } = setup();
      component.campaign = campaign();
      for (const status of ['draft', 'scheduled']) {
        expect(component.isEditableTouch(touch({ status } as Partial<CampaignEmailModel>)))
          .withContext(status).toBeTrue();
        expect(component.canDeleteTouch(touch({ status } as Partial<CampaignEmailModel>)))
          .withContext(status).toBeTrue();
      }
    });

    it('never allows deleting one that is sending or sent', () => {
      // 'sending' is mid-drain and deleting would strand its ledger; 'sent'
      // is history and may already be published to the public site.
      const { component } = setup();
      component.campaign = campaign();
      for (const status of ['sending', 'sent']) {
        expect(component.canDeleteTouch(touch({ status } as Partial<CampaignEmailModel>)))
          .withContext(status).toBeFalse();
        expect(component.isEditableTouch(touch({ status } as Partial<CampaignEmailModel>)))
          .withContext(status).toBeFalse();
      }
    });

    it('respects the delete permission even on a draft', () => {
      const { component } = setup({ canEdit: true, canDelete: false });
      component.campaign = campaign();
      expect(component.canDeleteTouch(touch({ status: 'draft' } as Partial<CampaignEmailModel>))).toBeFalse();
    });

    it('respects the edit permission even on a draft', () => {
      const { component } = setup({ canEdit: false });
      component.campaign = campaign();
      expect(component.isEditableTouch(touch({ status: 'draft' } as Partial<CampaignEmailModel>))).toBeFalse();
    });
  });

  describe('adding an email', () => {
    it('is offered only when the campaign actually has the email channel', () => {
      const { component } = setup();
      component.campaign = campaign({ channels: ['web'] });
      expect(component.canAddEmail()).toBeFalse();

      component.campaign = campaign({ channels: ['email'] });
      expect(component.canAddEmail()).toBeTrue();
    });

    it('respects the add permission', () => {
      const { component } = setup({ canAdd: false });
      component.campaign = campaign({ channels: ['email'] });
      expect(component.canAddEmail()).toBeFalse();
    });

    it('navigates to the full-screen editor rather than swapping an in-page mode', () => {
      // Changed 2026-08-21 - the editor became its own route.
      const { component, navigated } = setup();
      component.campaign = campaign();
      component.newEmail();
      expect(navigated[0][0]).toEqual(['/campaigns-manager/email', 'camp-1', 'new']);
    });

    it('opens an existing draft by its own id', () => {
      const { component, navigated } = setup();
      component.campaign = campaign();
      component.editTouch(touch({ id: 't9', status: 'draft' } as Partial<CampaignEmailModel>));
      expect(navigated[0][0]).toEqual(['/campaigns-manager/email', 'camp-1', 't9']);
    });

    it('does not navigate when the touch is not editable', () => {
      const { component, navigated } = setup();
      component.campaign = campaign();
      component.editTouch(touch({ id: 't9', status: 'sent' } as Partial<CampaignEmailModel>));
      expect(navigated.length).toBe(0);
    });
  });

  describe('publishing to the website', () => {
    it('is offered only for emails that actually went out', () => {
      const { component } = setup();
      component.campaign = campaign();
      expect(component.canPublishToWeb(touch({ status: 'sent' } as Partial<CampaignEmailModel>))).toBeTrue();
      expect(component.canPublishToWeb(touch({ status: 'sending' } as Partial<CampaignEmailModel>))).toBeTrue();
      expect(component.canPublishToWeb(touch({ status: 'draft' } as Partial<CampaignEmailModel>))).toBeFalse();
      expect(component.canPublishToWeb(touch({ status: 'scheduled' } as Partial<CampaignEmailModel>))).toBeFalse();
    });

    it('respects the edit permission', () => {
      const { component } = setup({ canEdit: false });
      component.campaign = campaign();
      expect(component.canPublishToWeb(touch({ status: 'sent' } as Partial<CampaignEmailModel>))).toBeFalse();
    });
  });

  describe('touchStatusLabel', () => {
    it('shows live progress while a send is draining', () => {
      const { component } = setup();
      const sending = touch({
        status: 'sending',
        recipientCount: 500,
        stats: { ...emptyEmailStats(), sent: 120 },
      } as Partial<CampaignEmailModel>);
      expect(component.touchStatusLabel(sending)).toBe('SENDING 120/500');
    });

    it('copes with a sending touch whose recipient count is not known yet', () => {
      const { component } = setup();
      const sending = touch({ status: 'sending' } as Partial<CampaignEmailModel>);
      expect(component.touchStatusLabel(sending)).toBe('SENDING 0/?');
    });

    it('upper-cases any other status', () => {
      const { component } = setup();
      expect(component.touchStatusLabel(touch({ status: 'draft' } as Partial<CampaignEmailModel>))).toBe('DRAFT');
    });

    it('treats a touch with no status at all as sent', () => {
      // Imported Mailchimp history carries no status field.
      const { component } = setup();
      expect(component.touchStatusLabel(touch())).toBe('SENT');
    });
  });
});
