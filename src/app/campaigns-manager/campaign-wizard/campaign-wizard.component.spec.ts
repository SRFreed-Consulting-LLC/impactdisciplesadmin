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
      { provide: SnackbarService, useValue: { error: () => undefined, success: () => undefined } },
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

  return { component, saved, navigated, confirmed };
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
