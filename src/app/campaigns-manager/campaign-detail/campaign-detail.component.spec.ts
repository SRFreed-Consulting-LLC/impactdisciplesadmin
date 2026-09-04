import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignModel, emptyCampaignStats, emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { CampaignPopupService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignOfferService } from 'src/app/common/services/data/campaign-offer.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { CampaignDetailComponent } from './campaign-detail.component';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { Functions } from '@angular/fire/functions';

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
      { provide: CampaignService, useValue: { findLiveCampaignFor: () => Promise.resolve(null) } },
      { provide: CampaignPopupService, useValue: { getById: () => Promise.resolve(null) } },
      // Lifecycle collaborators - inert here; the cascade has its own harness below.
      { provide: CampaignOfferService, useValue: { forCampaign: () => Promise.resolve(null) } },
      { provide: CouponService, useValue: {} },
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

    it('tells the designer which campaign launched it', () => {
      // Without fromCampaign the designer's Back button falls through to
      // System Templates - a different manager entirely - stranding whoever
      // just edited a campaign email with no way back but browser history.
      const { component, navigated } = setup();
      component.campaign = campaign();
      component.openInDesigner(touch({ id: 't4' } as Partial<CampaignEmailModel>));
      expect(navigated[0][0]).toEqual(['/tools-manager/email-designer/new']);
      expect(navigated[0][1]).toEqual({
        queryParams: { fromEmail: 't4', fromCampaign: 'camp-1' }
      });
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

// ---------------------------------------------------------------------------
// Status lifecycle (2026-08-22)
//
// Added because nothing in the app could take a campaign off draft: the wizard
// wrote `status: campaign?.status ?? 'draft'` and no other path wrote live or
// scheduled, so every campaign made in the UI stayed a draft and the Live Now
// hub was permanently empty.
//
// What is pinned here is the part that costs money if it drifts: a draft
// campaign never discounts, ending a campaign actually STOPS its discount, and
// one failing cascade step is reported rather than swallowed. Its own harness,
// so the 22 tests above keep their smaller provider set.

interface LifecycleStubs {
  status?: CampaignModel['status'];
  startDate?: Date | null;
  endDate?: Date | null;
  couponId?: string | null;
  popup?: { isActive: boolean } | null;
  offer?: Record<string, unknown> | null;
  conflicts?: Record<string, unknown>[];
  confirmAnswer?: boolean;
  /** Another LIVE campaign already holding this one's product/event. */
  liveHolder?: { id: string; name: string } | null;
  failOn?: 'popup' | 'offer' | 'coupon' | 'campaign';
}

function lifecycleSetup(stubs: LifecycleStubs = {}) {
  const writes: { target: string; fields: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const successes: string[] = [];
  const confirmed: string[] = [];

  const record = (target: string) => (_id: string, fields: Record<string, unknown>) => {
    if (stubs.failOn === target) {
      return Promise.reject(new Error('boom'));
    }
    writes.push({ target, fields });
    return Promise.resolve();
  };

  // activate() writes the campaign and its offer in ONE batch, so they can
  // never half-apply. The stub collects staged operations and only records
  // them as writes on commit() - which is what makes "nothing was written"
  // provable when the commit fails.
  const commits: { table: string; fields: Record<string, unknown> }[][] = [];
  const TABLE_TARGET: Record<string, string> = {
    campaigns: 'campaign',
    campaign_offers: 'offer',
  };
  interface StubBatch {
    ops: { table: string; fields: Record<string, unknown> }[];
    commit: () => Promise<void>;
  }
  const daoStub = {
    batch: (): StubBatch => {
      const ops: { table: string; fields: Record<string, unknown> }[] = [];
      return {
        ops,
        commit: () => {
          const failing = ops.find(
            (op) => stubs.failOn === TABLE_TARGET[op.table]
          );
          if (failing) {
            // A batch is all-or-nothing: nothing lands, so nothing is
            // recorded.
            return Promise.reject(new Error('boom'));
          }
          commits.push(ops);
          for (const op of ops) {
            writes.push({ target: TABLE_TARGET[op.table] ?? op.table, fields: op.fields });
          }
          return Promise.resolve();
        },
      };
    },
    batchUpdateFields: (
      batch: StubBatch,
      _id: string,
      table: string,
      fields: Record<string, unknown>
    ) => {
      batch.ops.push({ table, fields });
    },
    // R1 moved activate/end onto the REAL CampaignService, so this harness
    // now provides that service for real (see below) rather than stubbing
    // it. These three are what BaseService delegates to underneath.
    updateFields: (_id: string, table: string, fields: Record<string, unknown>) => {
      if (stubs.failOn === TABLE_TARGET[table]) {
        return Promise.reject(new Error('boom'));
      }
      writes.push({ target: TABLE_TARGET[table] ?? table, fields });
      return Promise.resolve();
    },
    getAllByValue: () =>
      Promise.resolve(stubs.liveHolder ? [{ ...stubs.liveHolder, status: 'live' }] : []),
    getById: (id: string) => Promise.resolve({ id, name: 'Other Campaign' }),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      CampaignDetailComponent,
      { provide: CampaignEmailService, useValue: { getPage: () => Promise.resolve({ items: [], cursor: null, hasMore: false }) } },
      // The REAL CampaignService, not a stub: R1 moved the activate batch
      // and the end cascade onto it, so stubbing it here would leave the
      // lifecycle tests below asserting nothing. Its dependencies are
      // stubbed instead, which keeps every assertion in this file pointed
      // at real behaviour.
      CampaignService,
      { provide: FirebaseDAO, useValue: daoStub },
      { provide: Functions, useValue: {} },
      {
        provide: CampaignPopupService,
        useValue: {
          getById: () => Promise.resolve(stubs.popup ?? null),
          updateFields: record('popup'),
        },
      },
      {
        provide: CampaignOfferService,
        useValue: {
          forCampaign: () => Promise.resolve(stubs.offer ?? null),
          updateFields: record('offer'),
          deactivate: (id: string) => record('offer')(id, { isActive: false }),
          findConflicts: () => Promise.resolve(stubs.conflicts ?? []),
        },
      },
      { provide: CouponService, useValue: { updateFields: record('coupon') } },
      { provide: ProductService, useValue: { getById: () => Promise.resolve(null), getAll: () => Promise.resolve([]) } },
      { provide: EventService, useValue: { getById: () => Promise.resolve(null) } },
      {
        provide: PermissionService,
        useValue: { canAdd: () => true, canEdit: () => true, canDelete: () => true },
      },
      {
        provide: ConfirmService,
        useValue: {
          confirm: (message: string) => {
            confirmed.push(message);
            return Promise.resolve(stubs.confirmAnswer ?? true);
          },
        },
      },
      {
        provide: SnackbarService,
        useValue: {
          success: (m: string) => successes.push(m),
          error: (m: string) => errors.push(m),
        },
      },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }) }) } },
      { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
    ],
  });

  const component = TestBed.inject(CampaignDetailComponent);
  // A campaign that PROMOTES something, so the one-live-campaign gate has
  // a target to ask about. It used to be targetless and still hit the gate
  // because the CampaignService stub ignored its arguments; against the
  // real service a goal-less campaign is correctly never gated at all.
  component.campaign = campaign({
    goal: 'product',
    productId: 'prod-1',
    status: stubs.status ?? 'draft',
    startDate: stubs.startDate ?? null,
    endDate: stubs.endDate ?? null,
    couponId: stubs.couponId ?? null,
  });
  component.popup = (stubs.popup ?? null) as never;

  const wrote = (target: string) => writes.filter((w) => w.target === target).map((w) => w.fields);
  return { component, wrote, errors, successes, confirmed, commits };
}

const DAY = 24 * 60 * 60 * 1000;

describe('CampaignDetailComponent status lifecycle', () => {
  describe('activate', () => {
    it('puts a draft campaign live', async () => {
      const { component, wrote, successes } = lifecycleSetup();

      await component.activate();

      expect(wrote('campaign')).toEqual([{ status: 'live' }]);
      expect(successes[0]).toBe('Campaign is live');
    });

    // One live campaign per product/event (2026-08-25). Drafts do NOT reserve
    // a target, so activate() is where the rule actually bites.
    it('refuses to activate over another live campaign for the same target', async () => {
      const { component, wrote } = lifecycleSetup({
        liveHolder: { id: 'other-1', name: 'Summit Early Bird Special' },
        confirmAnswer: false,
      });

      await component.activate();

      // Nothing written at all - not the campaign, not its offer.
      expect(wrote('campaign')).toEqual([]);
      expect(component.campaign.status).toBe('draft');
    });

    it('names the campaign already holding the target', async () => {
      const { component, confirmed } = lifecycleSetup({
        liveHolder: { id: 'other-1', name: 'Summit Early Bird Special' },
        confirmAnswer: false,
      });

      await component.activate();

      // The author has to be able to tell WHICH campaign is in the way.
      expect(confirmed[0]).toContain('Summit Early Bird Special');
    });

    it('activates normally when no other campaign holds the target', async () => {
      const { component, wrote } = lifecycleSetup({ liveHolder: null });

      await component.activate();

      expect(wrote('campaign')).toEqual([{ status: 'live' }]);
    });

    // REOPEN (2026-09-04). An ended campaign used to show NEITHER button:
    // canActivate() offered itself only to drafts and canEnd() hides once a
    // campaign is ended, so the only way back to live was editing Firestore by
    // hand - which is exactly what had to be done to the Golf Tournament
    // campaign minutes before a 5,607-recipient send.
    it('offers REOPEN, not ACTIVATE, on an ended campaign', () => {
      const { component } = lifecycleSetup({ status: 'ended' });

      expect(component.canActivate()).toBeTrue();
      expect(component.isReopen()).toBeTrue();
      expect(component.activateLabel()).toBe('REOPEN');
    });

    it('still calls it ACTIVATE on a draft', () => {
      const { component } = lifecycleSetup();

      expect(component.isReopen()).toBeFalse();
      expect(component.activateLabel()).toBe('ACTIVATE');
    });

    // The trap behind the missing button: effectiveStatus() derives 'ended'
    // from a past end date as well as from the stored field, so writing
    // status:'live' alone reads straight back as ended and REOPEN looks
    // broken. The date has to be cleared IN THE SAME BATCH.
    it('clears a past end date when reopening, in one batch with the status', async () => {
      const { component, wrote, commits } = lifecycleSetup({
        status: 'ended',
        endDate: new Date(Date.now() - 30 * DAY),
      });

      await component.activate();

      expect(wrote('campaign')).toEqual([{ status: 'live', endDate: null }]);
      expect(commits.length).toBe(1);
      expect(component.campaign.endDate).toBeNull();
    });

    it('asks before wiping the end date, and writes nothing if refused', async () => {
      const { component, wrote, confirmed } = lifecycleSetup({
        status: 'ended',
        endDate: new Date(Date.now() - 30 * DAY),
        confirmAnswer: false,
      });

      await component.activate();

      expect(confirmed.join(' ')).toContain('clear that end date');
      expect(wrote('campaign')).toEqual([]);
      expect(component.campaign.status).toBe('ended');
    });

    // A campaign stored 'ended' whose end date is still ahead needs no date
    // surgery - only the stored field is holding it back.
    it('reopens without touching a future end date, and does not ask', async () => {
      const { component, wrote, confirmed } = lifecycleSetup({
        status: 'ended',
        endDate: new Date(Date.now() + 30 * DAY),
      });

      await component.activate();

      expect(wrote('campaign')).toEqual([{ status: 'live' }]);
      expect(confirmed.join(' ')).not.toContain('end date');
    });

    it('says the end date is gone, so nobody goes looking for it', async () => {
      const { component, successes } = lifecycleSetup({
        status: 'ended',
        endDate: new Date(Date.now() - DAY),
      });

      await component.activate();

      expect(successes[0]).toBe('Campaign reopened - it is live with no end date');
    });

    it('schedules rather than starts when the start date is still ahead', async () => {
      // effectiveStatus() promotes it on the day, so nobody has to come back.
      const { component, wrote, successes } = lifecycleSetup({
        startDate: new Date(Date.now() + DAY),
      });

      await component.activate();

      expect(wrote('campaign')).toEqual([{ status: 'scheduled' }]);
      expect(successes[0]).toBe('Campaign scheduled');
    });

    it('turns the offer on only when the campaign is actually live', async () => {
      const { component, wrote } = lifecycleSetup({ offer: { campaignId: 'camp-1' } });

      await component.activate();

      expect(wrote('offer')).toEqual([{ isActive: true }]);
    });

    it('writes the campaign and its offer in ONE atomic batch', async () => {
      // The bug this replaced: two sequential awaits with the status chip
      // flipping optimistically between them. Navigating away in that window
      // - or any failure on the second write - left the campaign live
      // advertising a discount that had never started, and nothing
      // recomputed it afterwards.
      const { component, commits } = lifecycleSetup({
        offer: { campaignId: 'camp-1' },
      });

      await component.activate();

      expect(commits.length).toBe(1);
      expect(commits[0]).toEqual([
        { table: 'campaigns', fields: { status: 'live' } },
        { table: 'campaign_offers', fields: { isActive: true } },
      ]);
    });

    it('activates a campaign with no offer in a single-write batch', async () => {
      const { component, commits, wrote } = lifecycleSetup();

      await component.activate();

      expect(commits.length).toBe(1);
      expect(commits[0].length).toBe(1);
      expect(wrote('offer')).toEqual([]);
    });

    it('leaves the status untouched locally when the batch fails', async () => {
      // All-or-nothing means the in-memory campaign must not claim a status
      // the database never took.
      const { component, wrote, errors } = lifecycleSetup({
        offer: { campaignId: 'camp-1' },
        failOn: 'offer',
      });

      await component.activate();

      expect(wrote('campaign')).toEqual([]);
      expect(wrote('offer')).toEqual([]);
      expect(component.campaign.status).toBe('draft');
      expect(errors.length).toBe(1);
    });

    it('leaves a scheduled campaign offer switched off', async () => {
      // The rule that matters: a campaign that has not started must not
      // discount anything.
      const { component, wrote } = lifecycleSetup({
        startDate: new Date(Date.now() + DAY),
        offer: { campaignId: 'camp-1' },
      });

      await component.activate();

      expect(wrote('offer')).toEqual([{ isActive: false }]);
    });

    it('warns before activating over another live discount, naming it', async () => {
      const { component, confirmed } = lifecycleSetup({
        offer: { campaignId: 'camp-1', target: { kind: 'product', id: 'p1' } },
        conflicts: [{ campaignId: 'camp-2' }],
      });

      await component.activate();

      expect(confirmed.length).toBe(1);
      expect(confirmed[0]).toContain('Other Campaign');
    });

    it('does not activate when the conflict warning is declined', async () => {
      const { component, wrote } = lifecycleSetup({
        offer: { campaignId: 'camp-1', target: { kind: 'product', id: 'p1' } },
        conflicts: [{ campaignId: 'camp-2' }],
        confirmAnswer: false,
      });

      await component.activate();

      expect(wrote('campaign')).toEqual([]);
    });

    it('does not warn when nothing overlaps', async () => {
      const { component, confirmed } = lifecycleSetup({
        offer: { campaignId: 'camp-1', target: { kind: 'product', id: 'p1' } },
        conflicts: [],
      });

      await component.activate();

      expect(confirmed).toEqual([]);
    });

    // This used to assert the OPPOSITE - that an ended campaign could not be
    // activated. That was the bug, not the rule: paired with canEnd() hiding
    // itself on an ended campaign, it left no button at all and no way back to
    // live short of editing Firestore. Reopening is now offered (as REOPEN);
    // what still must not happen is offering it to someone who cannot edit.
    it('offers reopening once the campaign has ended', () => {
      const { component } = lifecycleSetup({ status: 'ended' });
      expect(component.canActivate()).toBeTrue();
    });

    it('offers nothing at all to someone who cannot edit the campaign', () => {
      const { component } = lifecycleSetup({ status: 'ended' });
      spyOn(component, 'canEditCampaign').and.returnValue(false);
      expect(component.canActivate()).toBeFalse();
    });
  });

  describe('endCampaign', () => {
    it('ends the campaign and stamps an end date', async () => {
      const { component, wrote } = lifecycleSetup({ status: 'live' });

      await component.endCampaign();

      const fields = wrote('campaign')[0];
      expect(fields['status']).toBe('ended');
      expect(fields['endDate']).toEqual(jasmine.any(Date));
    });

    it('stops the popup, the discount and the coupon', async () => {
      // The cascade IS the feature - a campaign marked ended whose discount
      // keeps applying is worse than no button at all.
      const { component, wrote } = lifecycleSetup({
        status: 'live',
        popup: { isActive: true },
        offer: { campaignId: 'camp-1' },
        couponId: 'coupon-1',
      });

      await component.endCampaign();

      expect(wrote('popup')).toEqual([{ isActive: false }]);
      expect(wrote('offer')).toEqual([{ isActive: false }]);
      expect(wrote('coupon')).toEqual([{ isActive: false }]);
    });

    it('skips what the campaign does not have', async () => {
      const { component, wrote } = lifecycleSetup({ status: 'live' });

      await component.endCampaign();

      expect(wrote('popup')).toEqual([]);
      expect(wrote('offer')).toEqual([]);
      expect(wrote('coupon')).toEqual([]);
    });

    it('does nothing when the confirm is declined', async () => {
      const { component, wrote } = lifecycleSetup({ status: 'live', confirmAnswer: false });

      await component.endCampaign();

      expect(wrote('campaign')).toEqual([]);
    });

    it('reports by name when a cascade step fails, instead of claiming success', async () => {
      // Ending the campaign but silently leaving the discount live is the
      // failure mode worth catching.
      const { component, errors, successes } = lifecycleSetup({
        status: 'live',
        offer: { campaignId: 'camp-1' },
        failOn: 'offer',
      });

      await component.endCampaign();

      expect(successes).toEqual([]);
      expect(errors[0]).toContain('discount');
    });

    it('stops before the cascade when the campaign write itself fails', async () => {
      const { component, wrote, errors } = lifecycleSetup({
        status: 'live',
        popup: { isActive: true },
        failOn: 'campaign',
      });

      await component.endCampaign();

      expect(wrote('popup')).toEqual([]);
      expect(errors[0]).toContain('Could not end the campaign');
    });

    it('is unavailable on an already-ended campaign', () => {
      const { component } = lifecycleSetup({ status: 'ended' });
      expect(component.canEnd()).toBeFalse();
    });
  });
});
