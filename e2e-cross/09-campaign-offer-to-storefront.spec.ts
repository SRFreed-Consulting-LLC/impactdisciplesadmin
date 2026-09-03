import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator, seamed } from './support/harness';

// Charter area: a campaign's OFFER, from the admin screen to the price a
// shopper is actually shown (Campaign Manager v3).
//
// This is the flow the whole v3 build rests on and the one nothing else
// covers: the storefront can never read a campaign - campaign docs are
// staff-only and stay that way - so an offer is PUBLISHED to its own
// public collection, and the price a shopper sees depends on that
// publication being right. Unit tests prove the arithmetic; only this
// proves the two apps agree.
//
// Deliberately a LIFECYCLE rather than three unrelated cases, because the
// order is the point: a draft campaign must not discount, activating must
// start it, and ending must stop it. Run out of order they would each pass
// while the feature was still broken.
//
// The campaign and its offer are seeded through Firestore REST rather than
// driven through the wizard: what is under test here is activation and the
// storefront's reading of it, and clicking through a nine-field wizard would
// make this a wizard test that fails for wizard reasons.

const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

// prod-book-physical: cost 20, no stored salePrice - so full price is $20.00
// and the offer below takes it to $15.00.
const PRODUCT_ID = 'prod-book-physical';
const PRODUCT_TITLE = 'Disciple-Making Field Guide';
const FULL_PRICE = '$20.00';
const OFFER_PRICE = '$15.00';

const CAMPAIGN_ID = 'camp-offer-cross';

async function fsWrite(path: string, fields: unknown): Promise<void> {
  const res = await fetch(`${FS_BASE}/${seamed(path)}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`seed ${path} failed: ${res.status} ${await res.text()}`);
  }
}

/** Firestore REST value helpers - only the shapes this spec seeds. */
const str = (stringValue: string) => ({ stringValue });
const bool = (booleanValue: boolean) => ({ booleanValue });
const num = (n: number) => ({ integerValue: String(n) });

async function seedCampaignWithOffer(): Promise<void> {
  await fsWrite(`campaigns/${CAMPAIGN_ID}`, {
    name: str('Cross Offer Campaign'),
    goal: str('product'),
    productId: str(PRODUCT_ID),
    // DRAFT on purpose: the first test proves a draft discounts nothing.
    status: str('draft'),
    channels: { arrayValue: { values: [str('email')] } },
    schemaVersion: num(2),
  });

  await fsWrite(`campaign_offers/${CAMPAIGN_ID}`, {
    campaignId: str(CAMPAIGN_ID),
    target: {
      mapValue: { fields: { kind: str('product'), id: str(PRODUCT_ID) } },
    },
    discount: {
      mapValue: { fields: { type: str('percentOff'), value: num(25) } },
    },
    freeShipping: bool(false),
    // Inactive, exactly as the wizard publishes it for a draft campaign.
    isActive: bool(false),
    requiresAttribution: bool(false),
  });
}

/** The product's price as the public store page renders it. */
async function storePriceText(page: Page): Promise<string> {
  await page.goto(`${WEB_URL}/product-details/${PRODUCT_ID}`);
  await expect(page.getByText(PRODUCT_TITLE).first()).toBeVisible({ timeout: 30_000 });
  return (await page.locator('body').innerText());
}

async function openCampaign(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
  // The DETAIL view, not the list behind it - the list also renders status
  // chips, so a bare .status-live matches a different campaign entirely.
  await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.detail-header__name')).toContainText('Cross Offer Campaign');
}

/**
 * Waits for an action to FINISH, not merely to look finished.
 *
 * The status chip flips from an optimistic local assignment the moment the
 * campaign write resolves - before the offer has been published. Asserting on
 * the chip and navigating away aborts that second write in flight, which is
 * exactly how this spec first "proved" activation did not work.
 *
 * The snackbar is raised after every step has completed, so it is the only
 * honest signal that it is safe to go and look at the storefront.
 */
async function waitForDone(page: Page, message: RegExp): Promise<void> {
  // .first(): the label matches both the wrapper and the inner element.
  await expect(page.locator('.mat-mdc-snack-bar-label').first()).toContainText(message, { timeout: 30_000 });
}

test.describe('[campaign-offer] Offer to storefront', () => {
  test.beforeAll(async () => {
    reseedEmulator();
    await seedCampaignWithOffer();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('a DRAFT campaign discounts nothing', async ({ page }) => {
    // The rule that costs money if it drifts. The offer document exists and
    // names this product - only its isActive flag stands between a shopper
    // and a discount nobody has started yet.
    const body = await storePriceText(page);

    expect(body).toContain(FULL_PRICE);
    expect(body).not.toContain(OFFER_PRICE);
  });

  test('ACTIVATE puts the campaign live and the storefront price drops', async ({ page }) => {
    await openCampaign(page);

    await page.getByRole('button', { name: /activate/i }).click();
    await waitForDone(page, /campaign is live/i);

    const body = await storePriceText(page);
    expect(body).toContain(OFFER_PRICE);
  });

  test('END CAMPAIGN stops the discount', async ({ page }) => {
    // The cascade. A campaign marked ended whose discount keeps applying is
    // worse than having no button at all.
    await openCampaign(page);

    await page.getByRole('button', { name: /end campaign/i }).click();
    // Accept the confirm. Scoped to the DIALOG: an unscoped name match hits
    // the toolbar's own END CAMPAIGN button sitting behind the backdrop, which
    // then never becomes clickable.
    const confirm = page.locator('mat-dialog-actions');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole('button', { name: 'OK' }).click();
    await waitForDone(page, /campaign ended/i);

    const body = await storePriceText(page);
    expect(body).toContain(FULL_PRICE);
    expect(body).not.toContain(OFFER_PRICE);
  });
});
