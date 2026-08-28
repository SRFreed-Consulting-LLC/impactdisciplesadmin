/**
 * The campaign wizard's save-time validation rules, as pure functions.
 *
 * Sweep finding R3. These eleven rules used to live inline in
 * CampaignWizardComponent.save(), which was 132 lines - the longest method
 * in src/app by 40 - and about 78 of those lines were this cascade. Being
 * inside a component method, none of them could be exercised without
 * standing the component up, so in practice none of them were tested at
 * all. They are a pure function of the form value plus two derived
 * booleans, so that is what they are now.
 *
 * WHY TWO FUNCTIONS AND NOT ONE. The wizard's other guard - one live
 * campaign per product/event (CampaignService.findLiveCampaignFor) - is
 * asynchronous and sits BETWEEN these two groups. A campaign missing its
 * target never reaches it; a campaign missing a channel does. Collapsing
 * everything into a single call ahead of that check would quietly change
 * which failure the author is shown, so the split is deliberate and
 * campaign-wizard.component.spec.ts pins the ordering.
 *
 * Each returns the message to show, or null when the group passes. The
 * message strings ARE the contract - they are what the author reads.
 */

export interface CampaignWizardValidationInput {
  goal?: string | null;
  productId?: string | null;
  eventId?: string | null;
  emailChannel?: boolean | null;
  webChannel?: boolean | null;
  facebookChannel?: boolean | null;
  twitterChannel?: boolean | null;
  instagramChannel?: boolean | null;
  offerEnabled?: boolean | null;
  offerTargetId?: string | null;
  offerDiscountType?: string | null;
  offerDiscountValue?: number | string | null;
  couponEnabled?: boolean | null;
  couponId?: string | null;
  couponCode?: string | null;
  couponPercentOff?: number | string | null;
  couponExpiresAt?: unknown;
}

export interface CampaignWizardValidationContext {
  /** couponId is the "create a new one" sentinel. */
  creatingCoupon: boolean;
  /** The campaign is open-ended, so a coupon expiry must be chosen. */
  couponNeedsExpiry: boolean;
}

/**
 * Rules that decide WHAT the campaign promotes. Checked before the
 * live-campaign guard, because that guard needs a target to ask about.
 */
export function validateCampaignTarget(
  value: CampaignWizardValidationInput
): string | null {
  if (value.goal === 'product' && !value.productId) {
    return 'Pick the product this campaign promotes.';
  }
  if (value.goal === 'event' && !value.eventId) {
    return 'Pick the event this campaign promotes.';
  }
  return null;
}

/**
 * Everything else: channels, the offer, and the coupon. Checked after the
 * live-campaign guard has had its say.
 */
export function validateCampaignDetails(
  value: CampaignWizardValidationInput,
  ctx: CampaignWizardValidationContext
): string | null {
  const socialPicked =
    value.facebookChannel || value.twitterChannel || value.instagramChannel;
  if (!value.emailChannel && !value.webChannel && !socialPicked) {
    return 'Pick at least one channel - email, web popup, or social.';
  }

  const offerError = validateOffer(value);
  if (offerError) {
    return offerError;
  }

  return validateCoupon(value, ctx);
}

function validateOffer(value: CampaignWizardValidationInput): string | null {
  if (!value.offerEnabled) {
    return null;
  }
  if (!value.offerTargetId) {
    return 'Pick what the offer applies to.';
  }
  const amount = Number(value.offerDiscountValue);
  if (!Number.isFinite(amount) || amount <= 0) {
    return value.offerDiscountType === 'fixedPrice'
      ? 'Enter the early-bird price.'
      : 'Enter a percentage off.';
  }
  if (value.offerDiscountType === 'percentOff' && amount > 100) {
    return 'A percentage off cannot exceed 100.';
  }
  return null;
}

function validateCoupon(
  value: CampaignWizardValidationInput,
  ctx: CampaignWizardValidationContext
): string | null {
  if (!value.couponEnabled) {
    return null;
  }
  if (!value.couponId) {
    return 'Pick a coupon to give subscribers, or create one.';
  }
  if (ctx.creatingCoupon) {
    const code = (value.couponCode ?? '').trim();
    const percent = Number(value.couponPercentOff);
    if (!code) {
      return 'Enter the coupon code subscribers will type.';
    }
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return 'Enter a coupon percentage between 1 and 100.';
    }
  }
  // An open-ended campaign has no end date to inherit, so the expiry has to
  // be chosen - otherwise the code stays live for years.
  if (ctx.couponNeedsExpiry && !value.couponExpiresAt) {
    return 'This campaign has no end date, so give the coupon its own expiry.';
  }
  return null;
}
