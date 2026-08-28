import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { CampaignWizardComponent } from './campaign-wizard.component';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { CampaignOfferService } from 'src/app/common/services/data/campaign-offer.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';

// Mirrors the component's own private sentinel (campaign-wizard.component.ts).
// creatingCoupon is a getter comparing couponId to this, so a test that wants
// the inline-create branch has to put this in the form.
const NEW_COUPON = '__new__';

// ONE LIVE CAMPAIGN PER PRODUCT/EVENT (2026-08-25, owner rule).
//
// The wizard is the creation AND edit path for a campaign's target, so it is
// half the rule; activate() in campaign-detail is the other half and has its
// own tests. Only the guard is covered here - the wizard had no spec at all
// before this, and a broad one written blind would pin behaviour nobody has
// examined rather than behaviour anyone decided on.
//
// TestBed-as-injector rather than `new CampaignWizardComponent(...)`, so
// these survive the repo's move to inject().

interface Stubs {
  liveHolder?: { id: string; name: string } | null;
  confirmAnswer?: boolean;
}

function setup(stubs: Stubs = {}) {
  const saved: CampaignModel[] = [];
  const navigated: unknown[][] = [];
  const confirmed: string[] = [];
  const errors: string[] = [];

  TestBed.configureTestingModule({
    providers: [
      CampaignWizardComponent,
      FormBuilder,
      {
        provide: CampaignService,
        useValue: {
          findLiveCampaignFor: () => Promise.resolve(stubs.liveHolder ?? null),
          add: (c: CampaignModel) => { saved.push(c); return Promise.resolve({ ...c, id: 'new-1' }); },
          update: (_id: string, c: CampaignModel) => { saved.push(c); return Promise.resolve(c); },
        },
      },
      {
        provide: ConfirmService,
        useValue: {
          confirm: (message: string) => {
            confirmed.push(message);
            return Promise.resolve(stubs.confirmAnswer ?? false);
          },
        },
      },
      { provide: Router, useValue: { navigate: (...args: unknown[]) => { navigated.push(args); return Promise.resolve(true); } } },
      { provide: ProductService, useValue: { getAllByValue: () => Promise.resolve([]), getAll: () => Promise.resolve([]) } },
      { provide: EventService, useValue: { getAll: () => Promise.resolve([]) } },
      { provide: TagRuleService, useValue: { getAll: () => Promise.resolve([]) } },
      { provide: SeriesService, useValue: { getAll: () => Promise.resolve([]) } },
      { provide: CampaignOfferService, useValue: { forCampaign: () => Promise.resolve(null) } },
      { provide: CouponService, useValue: { getAll: () => Promise.resolve([]) } },
      { provide: PermissionService, useValue: { canAdd: () => true, canEdit: () => true } },
      {
        provide: SnackbarService,
        useValue: {
          error: (m: string) => { errors.push(m); },
          success: () => undefined,
        },
      },
    ],
  });

  const component = TestBed.inject(CampaignWizardComponent);
  // A minimally valid product campaign - enough to reach the guard.
  component.form.patchValue({
    name: 'Spring Book Push',
    goal: 'product',
    productId: 'prod-1',
    emailChannel: true,
    audienceMode: 'all',
  });

  return { component, saved, navigated, confirmed, errors };
}

describe('CampaignWizardComponent one-live-campaign-per-target', () => {
  it('refuses to save when another live campaign already holds the product', async () => {
    const { component, saved } = setup({
      liveHolder: { id: 'other-1', name: 'Impact Series Launch' },
    });

    await component.save();

    expect(saved).toEqual([]);
  });

  it('names the campaign standing in the way', async () => {
    const { component, confirmed } = setup({
      liveHolder: { id: 'other-1', name: 'Impact Series Launch' },
    });

    await component.save();

    // Without the name the author cannot tell what to go and end.
    expect(confirmed[0]).toContain('Impact Series Launch');
  });

  it('opens the blocking campaign when the author asks to', async () => {
    const { component, navigated } = setup({
      liveHolder: { id: 'other-1', name: 'Impact Series Launch' },
      confirmAnswer: true,
    });

    await component.save();

    expect(navigated.length).toBe(1);
    expect(JSON.stringify(navigated[0])).toContain('other-1');
  });

  it('stays put when the author declines', async () => {
    const { component, navigated } = setup({
      liveHolder: { id: 'other-1', name: 'Impact Series Launch' },
      confirmAnswer: false,
    });

    await component.save();

    expect(navigated).toEqual([]);
  });

  it('saves normally when nothing else holds the product', async () => {
    const { component, saved } = setup({ liveHolder: null });

    await component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].productId).toBe('prod-1');
  });

  it('never blocks a goal-other campaign, which has no target at all', async () => {
    // The 68 newsletter/prayer campaigns in prod are all goal 'other' - the
    // rule must not touch them. findLiveCampaignFor returns null for them by
    // contract, so a holder here would mean the guard asked the wrong question.
    const { component, saved } = setup({ liveHolder: null });
    component.form.patchValue({ goal: 'other', otherKind: 'general', productId: null });

    await component.save();

    expect(saved.length).toBe(1);
    expect(saved[0].goal).toBe('other');
  });
});

// CHARACTERIZATION tests, written 2026-08-28 immediately BEFORE extracting
// save()'s validation cascade into pure functions (sweep finding R3 - the
// method is 132 lines, ~78 of them these eleven rules, and none of them
// were exercised by anything).
//
// They assert the CURRENT behaviour, message text included, so the
// extraction can be proved to have changed nothing. The message strings are
// the contract here: they are what the author actually sees.
describe('CampaignWizardComponent save() validation (characterization)', () => {
  it('demands a product when the goal is product', async () => {
    const { component, saved, errors } = setup();
    component.form.patchValue({ goal: 'product', productId: null });

    await component.save();

    expect(errors).toEqual(['Pick the product this campaign promotes.']);
    expect(saved.length).toBe(0);
  });

  it('demands an event when the goal is event', async () => {
    const { component, saved, errors } = setup();
    component.form.patchValue({ goal: 'event', eventId: null });

    await component.save();

    expect(errors).toEqual(['Pick the event this campaign promotes.']);
    expect(saved.length).toBe(0);
  });

  it('demands at least one channel', async () => {
    const { component, saved, errors } = setup();
    component.form.patchValue({ emailChannel: false, webChannel: false });

    await component.save();

    expect(errors).toEqual([
      'Pick at least one channel - email, web popup, or social.',
    ]);
    expect(saved.length).toBe(0);
  });

  it('accepts a social-only campaign as having a channel', async () => {
    const { component, saved } = setup();
    component.form.patchValue({
      emailChannel: false, webChannel: false, instagramChannel: true,
    });

    await component.save();

    expect(saved.length).toBe(1);
  });

  it('demands a target for an enabled offer', async () => {
    const { component, errors } = setup();
    component.form.patchValue({ offerEnabled: true, offerTargetId: null });

    await component.save();

    expect(errors).toEqual(['Pick what the offer applies to.']);
  });

  it('demands a positive offer amount, worded for the discount type',
    async () => {
      const { component, errors } = setup();
      component.form.patchValue({
        offerEnabled: true,
        offerTargetId: 'prod-1',
        offerDiscountType: 'percentOff',
        offerDiscountValue: 0,
      });

      await component.save();

      expect(errors).toEqual(['Enter a percentage off.']);
    });

  it('words the same failure differently for a fixed early-bird price',
    async () => {
      const { component, errors } = setup();
      component.form.patchValue({
        offerEnabled: true,
        offerTargetId: 'prod-1',
        offerDiscountType: 'fixedPrice',
        offerDiscountValue: null,
      });

      await component.save();

      expect(errors).toEqual(['Enter the early-bird price.']);
    });

  it('refuses a percentage over 100', async () => {
    const { component, errors } = setup();
    component.form.patchValue({
      offerEnabled: true,
      offerTargetId: 'prod-1',
      offerDiscountType: 'percentOff',
      offerDiscountValue: 101,
    });

    await component.save();

    expect(errors).toEqual(['A percentage off cannot exceed 100.']);
  });

  it('demands a coupon when the coupon step is enabled', async () => {
    const { component, errors } = setup();
    component.form.patchValue({ couponEnabled: true, couponId: null });

    await component.save();

    expect(errors).toEqual([
      'Pick a coupon to give subscribers, or create one.',
    ]);
  });

  it('demands a code and a valid percent when creating a coupon inline',
    async () => {
      const { component, errors } = setup();
      // creatingCoupon is a getter off couponId, not a settable field.
      component.form.patchValue({
        couponEnabled: true, couponId: NEW_COUPON, couponCode: '  ',
      });

      await component.save();

      expect(errors).toEqual([
        'Enter the coupon code subscribers will type.',
      ]);
    });

  it('bounds an inline coupon percentage to 1-100', async () => {
    const { component, errors } = setup();
    component.form.patchValue({
      couponEnabled: true,
      couponId: NEW_COUPON,
      couponCode: 'SPRING',
      couponPercentOff: 0,
    });

    await component.save();

    expect(errors).toEqual([
      'Enter a coupon percentage between 1 and 100.',
    ]);
  });

  it('demands a coupon expiry when the campaign is open-ended', async () => {
    const { component, errors } = setup();
    // couponNeedsExpiry is couponEnabled && no endDate - drive it that way.
    component.form.patchValue({
      couponEnabled: true,
      couponId: 'existing-1',
      endDate: null,
      couponExpiresAt: null,
    });

    await component.save();

    expect(errors).toEqual([
      'This campaign has no end date, so give the coupon its own expiry.',
    ]);
  });

  // ORDER IS BEHAVIOUR. The one-live-campaign check is asynchronous and sits
  // BETWEEN the target rules and the rest, so a campaign that fails a target
  // rule never reaches it. Any extraction that hoists all eleven rules into
  // one call ahead of that check would change which failure the author sees.
  it('reports a missing target before consulting the live-campaign guard',
    async () => {
      const { component, errors, confirmed } = setup({
        liveHolder: { id: 'c-9', name: 'Existing Push' },
      });
      component.form.patchValue({ goal: 'product', productId: null });

      await component.save();

      expect(errors).toEqual(['Pick the product this campaign promotes.']);
      expect(confirmed.length).toBe(0);
    });

  it('consults the live-campaign guard before the channel rule',
    async () => {
      const { component, errors, confirmed } = setup({
        liveHolder: { id: 'c-9', name: 'Existing Push' },
      });
      component.form.patchValue({ emailChannel: false, webChannel: false });

      await component.save();

      expect(confirmed.length).toBe(1);
      expect(errors).toEqual([]);
    });
});
