import {
  validateCampaignTarget,
  validateCampaignDetails,
  CampaignWizardValidationInput
} from './campaign-wizard-validation';

// The point of sweep finding R3: these eleven rules were unreachable
// without standing up CampaignWizardComponent, so nothing tested them.
// Now they are a pure function and this file needs no TestBed, no
// FormBuilder and no service stubs at all.
//
// campaign-wizard.component.spec.ts still drives the same rules THROUGH
// save() - those are the characterization tests that proved the extraction
// changed nothing, and they also pin the ordering against the async
// live-campaign guard, which is not expressible here. Keep both.

// A campaign that passes everything, so each test can break one thing.
const valid = (): CampaignWizardValidationInput => ({
  goal: 'product',
  productId: 'prod-1',
  emailChannel: true
});

const ctx = { creatingCoupon: false, couponNeedsExpiry: false };

describe('validateCampaignTarget', () => {
  it('passes a complete product campaign', () => {
    expect(validateCampaignTarget(valid())).toBeNull();
  });

  it('demands a product, but only when the goal is product', () => {
    expect(validateCampaignTarget({ goal: 'product', productId: null }))
      .toBe('Pick the product this campaign promotes.');
    // goal 'other' has no target at all - the 68 newsletter campaigns in
    // prod are all this shape.
    expect(validateCampaignTarget({ goal: 'other', productId: null }))
      .toBeNull();
  });

  it('demands an event, but only when the goal is event', () => {
    expect(validateCampaignTarget({ goal: 'event', eventId: null }))
      .toBe('Pick the event this campaign promotes.');
    expect(validateCampaignTarget({ goal: 'event', eventId: 'ev-1' }))
      .toBeNull();
  });
});

describe('validateCampaignDetails channels', () => {
  it('requires at least one', () => {
    expect(validateCampaignDetails({}, ctx))
      .toBe('Pick at least one channel - email, web popup, or social.');
  });

  it('accepts any single channel, social included', () => {
    for (const key of [
      'emailChannel', 'webChannel',
      'facebookChannel', 'twitterChannel', 'instagramChannel'
    ]) {
      expect(validateCampaignDetails({ [key]: true }, ctx))
        .withContext(key).toBeNull();
    }
  });
});

describe('validateCampaignDetails offer', () => {
  const withOffer = (over: CampaignWizardValidationInput) => ({
    ...valid(), offerEnabled: true, offerTargetId: 'prod-1', ...over
  });

  it('is skipped entirely when the offer is off', () => {
    expect(validateCampaignDetails(
      { ...valid(), offerEnabled: false, offerDiscountValue: -5 }, ctx
    )).toBeNull();
  });

  it('demands a target', () => {
    expect(validateCampaignDetails(
      withOffer({ offerTargetId: null }), ctx
    )).toBe('Pick what the offer applies to.');
  });

  it('words a missing amount for the discount type', () => {
    expect(validateCampaignDetails(
      withOffer({ offerDiscountType: 'percentOff', offerDiscountValue: 0 }),
      ctx
    )).toBe('Enter a percentage off.');
    expect(validateCampaignDetails(
      withOffer({ offerDiscountType: 'fixedPrice', offerDiscountValue: null }),
      ctx
    )).toBe('Enter the early-bird price.');
  });

  it('rejects a non-positive or unparseable amount', () => {
    for (const bad of [0, -1, 'free', null, undefined]) {
      expect(validateCampaignDetails(
        withOffer({ offerDiscountValue: bad as number }), ctx
      )).withContext(String(bad)).toBe('Enter a percentage off.');
    }
  });

  it('caps a percentage at 100 but leaves a fixed price uncapped', () => {
    expect(validateCampaignDetails(
      withOffer({ offerDiscountType: 'percentOff', offerDiscountValue: 101 }),
      ctx
    )).toBe('A percentage off cannot exceed 100.');
    // A fixed early-bird price of $101 is perfectly ordinary.
    expect(validateCampaignDetails(
      withOffer({ offerDiscountType: 'fixedPrice', offerDiscountValue: 101 }),
      ctx
    )).toBeNull();
  });
});

describe('validateCampaignDetails coupon', () => {
  const withCoupon = (over: CampaignWizardValidationInput) => ({
    ...valid(), couponEnabled: true, couponId: 'coupon-1', ...over
  });

  it('is skipped entirely when the coupon step is off', () => {
    expect(validateCampaignDetails(
      { ...valid(), couponEnabled: false, couponId: null }, ctx
    )).toBeNull();
  });

  it('demands a coupon', () => {
    expect(validateCampaignDetails(withCoupon({ couponId: null }), ctx))
      .toBe('Pick a coupon to give subscribers, or create one.');
  });

  it('only checks code and percent when creating one inline', () => {
    const picking = withCoupon({ couponCode: '', couponPercentOff: 0 });
    // Picking an existing coupon ignores both fields...
    expect(validateCampaignDetails(picking, ctx)).toBeNull();
    // ...creating one does not.
    expect(validateCampaignDetails(
      picking, { ...ctx, creatingCoupon: true }
    )).toBe('Enter the coupon code subscribers will type.');
  });

  it('treats a whitespace-only code as missing', () => {
    expect(validateCampaignDetails(
      withCoupon({ couponCode: '   ', couponPercentOff: 10 }),
      { ...ctx, creatingCoupon: true }
    )).toBe('Enter the coupon code subscribers will type.');
  });

  it('bounds an inline percentage to 1-100', () => {
    const create = { ...ctx, creatingCoupon: true };
    for (const bad of [0, -1, 101, 'half', null]) {
      expect(validateCampaignDetails(
        withCoupon({ couponCode: 'SPRING', couponPercentOff: bad as number }),
        create
      )).withContext(String(bad))
        .toBe('Enter a coupon percentage between 1 and 100.');
    }
    expect(validateCampaignDetails(
      withCoupon({ couponCode: 'SPRING', couponPercentOff: 100 }), create
    )).toBeNull();
  });

  it('demands an expiry only when the campaign is open-ended', () => {
    const noExpiry = withCoupon({ couponExpiresAt: null });
    expect(validateCampaignDetails(noExpiry, ctx)).toBeNull();
    expect(validateCampaignDetails(
      noExpiry, { ...ctx, couponNeedsExpiry: true }
    )).toBe('This campaign has no end date, so give the coupon its own expiry.');
  });
});

describe('validateCampaignDetails ordering', () => {
  it('reports the channel before the offer, and the offer before the coupon',
    () => {
      const broken: CampaignWizardValidationInput = {
        goal: 'product',
        productId: 'prod-1',
        offerEnabled: true,
        offerTargetId: null,
        couponEnabled: true,
        couponId: null
      };
      // No channel yet, so that is what the author is told first.
      expect(validateCampaignDetails(broken, ctx))
        .toBe('Pick at least one channel - email, web popup, or social.');
      // Fix it and the offer surfaces, not the coupon.
      expect(validateCampaignDetails({ ...broken, emailChannel: true }, ctx))
        .toBe('Pick what the offer applies to.');
    });
});
