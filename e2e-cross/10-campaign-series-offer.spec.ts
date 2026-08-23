import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: a SERIES-targeted offer, admin to storefront.
//
// Its own spec rather than another case in 09 because the failure mode is
// completely different: a product offer either matches its product or it
// does not, but a series offer matches by a value that lives on the PRODUCT -
// ProductModel.series is the display string, never the series doc id.
//
// That distinction is not academic. The wizard originally offered the series
// doc id as the target, which matched no product at all: the campaign saved,
// activated, reported itself live, and no price ever moved. Nothing else in
// the repo would have said so - which is exactly what this spec is for.
//
// The second assertion carries as much weight as the first: a product OUTSIDE
// the series must be left alone. The retired sitewide sale discounted every
// product in existence, so "some product got cheaper" was never evidence that
// targeting worked.

const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

// prod-book-physical (cost 20) is in "M-7 Series"; prod-shirt (cost 18) is
// Merchandise and belongs to no series at all.
const IN_SERIES_ID = 'prod-book-physical';
const IN_SERIES_TITLE = 'Disciple-Making Field Guide';
const OUT_OF_SERIES_ID = 'prod-shirt';
const OUT_OF_SERIES_TITLE = 'Impact Tee';

const SERIES_NAME = 'M-7 Series';
const CAMPAIGN_ID = 'camp-series-cross';

const str = (stringValue: string) => ({ stringValue });
const bool = (booleanValue: boolean) => ({ booleanValue });
const num = (n: number) => ({ integerValue: String(n) });

async function fsWrite(path: string, fields: unknown): Promise<void> {
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`seed ${path} failed: ${res.status} ${await res.text()}`);
  }
}

async function seedSeriesCampaign(): Promise<void> {
  await fsWrite(`campaigns/${CAMPAIGN_ID}`, {
    name: str('Series Offer Campaign'),
    goal: str('other'),
    otherKind: str('general'),
    status: str('draft'),
    channels: { arrayValue: { values: [str('email')] } },
    schemaVersion: num(2),
  });

  await fsWrite(`campaign_offers/${CAMPAIGN_ID}`, {
    campaignId: str(CAMPAIGN_ID),
    // The series NAME, because that is what a product carries.
    target: { mapValue: { fields: { kind: str('series'), id: str(SERIES_NAME) } } },
    discount: { mapValue: { fields: { type: str('percentOff'), value: num(50) } } },
    freeShipping: bool(false),
    isActive: bool(false),
    requiresAttribution: bool(false),
  });
}

/**
 * Everything the product page renders, as text.
 *
 * Waits for the TITLE, not merely for the component: the page mounts before
 * its product arrives, and reading the body in that window sees "$0" - a
 * price that belongs to no product and looks exactly like a pricing bug.
 */
async function productPageText(page: Page, productId: string, title: string): Promise<string> {
  await page.goto(`${WEB_URL}/product-details/${productId}`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  return page.locator('body').innerText();
}

/** Every published offer, flattened to just what this spec asserts on. */
async function listOffers(): Promise<{ campaignId: string; targetId: string }[]> {
  const res = await fetch(`${FS_BASE}/campaign_offers`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!res.ok) return [];
  const body = await res.json() as { documents?: Record<string, never>[] };
  return (body.documents ?? []).map((doc) => {
    const f = (doc as unknown as { fields: Record<string, { stringValue?: string; mapValue?: { fields: Record<string, { stringValue?: string }> } }> }).fields;
    return { campaignId: f['campaignId']?.stringValue ?? '', targetId: f['target']?.mapValue?.fields?.['id']?.stringValue ?? '' };
  });
}

async function waitForDone(page: Page, message: RegExp): Promise<void> {
  await expect(page.locator('.mat-mdc-snack-bar-label').first())
    .toContainText(message, { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('[campaign-offer] Series offer to storefront', () => {
  test.beforeAll(async () => {
    reseedEmulator();
    await seedSeriesCampaign();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('activating a series offer discounts every product in that series', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /activate/i }).click();
    // The snackbar, not the status chip: the chip flips optimistically before
    // the offer is published (see 09's own note).
    await waitForDone(page, /campaign is live/i);

    // 50% off 20.00.
    expect(await productPageText(page, IN_SERIES_ID, IN_SERIES_TITLE)).toContain('$10.00');
  });

  test('a product outside the series keeps its own price', async ({ page }) => {
    // The half that proves TARGETING rather than merely "a discount happened".
    const body = await productPageText(page, OUT_OF_SERIES_ID, OUT_OF_SERIES_TITLE);

    expect(body).toContain('$18.00');
    expect(body).not.toContain('$9.00');
  });

  test('ending the campaign restores the series price', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /end campaign/i }).click();
    const confirm = page.locator('mat-dialog-actions');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole('button', { name: 'OK' }).click();
    await waitForDone(page, /campaign ended/i);

    const body = await productPageText(page, IN_SERIES_ID, IN_SERIES_TITLE);
    expect(body).toContain('$20.00');
    expect(body).not.toContain('$10.00');
  });

  test('a series offer saved through the WIZARD targets a value products carry', async ({ page }) => {
    // Guards the bug this spec was written to catch, at its source. The picker
    // must hand the offer the same value a product carries - the series NAME -
    // or the campaign saves, activates, reports itself live, and silently
    // discounts nothing. Asserted on the PUBLISHED document rather than on the
    // dropdown, because what is stored is what the storefront will match on.
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns`);
    await page.getByRole('button', { name: /new campaign/i }).click();
    await expect(page.locator('app-campaign-wizard')).toBeVisible({ timeout: 20_000 });

    await page.locator('input[formControlName="name"]').fill('Series picker check');
    await page.getByText(/this campaign carries a discount/i).click();

    await page.locator('mat-select[formControlName="offerTargetKind"]').click();
    await page.getByRole('option', { name: 'A whole series' }).click();

    await page.locator('mat-select[formControlName="offerTargetId"]').click();
    await page.getByRole('option', { name: SERIES_NAME }).click();

    await page.locator('input[formControlName="offerDiscountValue"]').fill('10');
    await page.getByRole('button', { name: /save campaign/i }).click();

    // The published offer must name the series the way products do.
    await expect.poll(async () => {
      const offers = await listOffers();
      const mine = offers.find((o) => o.campaignId !== CAMPAIGN_ID);
      return mine?.targetId ?? 'none';
    }, { timeout: 30_000 }).toBe(SERIES_NAME);
  });
});
