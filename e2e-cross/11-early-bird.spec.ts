import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: EARLY BIRD - an event price shown only to someone who reached
// the event through the campaign.
//
// The one offer in the system that is not public. A product sale shows to
// every visitor; an early-bird registration price is a reward for being on
// the list, so the same page must show two different prices to two different
// people. Nothing else in the suite covers a price that depends on WHO is
// looking.
//
// Attribution is captured at bootstrap from the query string and kept in
// localStorage for 30 days, so each test gets its own browser context and the
// two visitors cannot contaminate each other.
//
// This is the DISPLAY half only. What a card is charged is re-derived
// server-side in computeOrderPricing, and integration/money.test.js pins that
// an unattributed buyer is refused the price - deliberately proven there,
// where the money actually moves, rather than through a checkout the emulator
// cannot complete.

const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

// event-workshop: costInDollars 10, active, so it registers normally.
const EVENT_ID = 'event-workshop';
const EVENT_NAME = 'Fall Multiplication Workshop';
const FULL_TOTAL = '$10';
const EARLY_BIRD_TOTAL = '$7';

const CAMPAIGN_ID = 'camp-earlybird-cross';

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

async function seedEarlyBird(): Promise<void> {
  await fsWrite(`campaigns/${CAMPAIGN_ID}`, {
    name: str('Early Bird Campaign'),
    goal: str('event'),
    eventId: str(EVENT_ID),
    status: str('draft'),
    channels: { arrayValue: { values: [str('email')] } },
    schemaVersion: num(2),
  });

  await fsWrite(`campaign_offers/${CAMPAIGN_ID}`, {
    campaignId: str(CAMPAIGN_ID),
    target: { mapValue: { fields: { kind: str('event'), id: str(EVENT_ID) } } },
    // fixedPrice REPLACES the registration price - it is not an amount off.
    // The name exists to stop exactly that misreading.
    discount: { mapValue: { fields: { type: str('fixedPrice'), value: num(7) } } },
    freeShipping: bool(false),
    isActive: bool(false),
    // The whole point of this spec.
    requiresAttribution: bool(true),
  });
}

/** The event page's totals block, once the event has actually loaded. */
async function eventPageText(page: Page, query = ''): Promise<string> {
  await page.goto(`${WEB_URL}/event-details/${EVENT_ID}${query}`);
  await expect(page.getByText(EVENT_NAME).first()).toBeVisible({ timeout: 30_000 });
  // Totals only render once a price is resolved, so wait for the block itself
  // rather than reading a page that has not finished pricing.
  await expect(page.locator('.cart-page-total')).toBeVisible({ timeout: 20_000 });
  return page.locator('.cart-page-total').innerText();
}

async function waitForDone(page: Page, message: RegExp): Promise<void> {
  await expect(page.locator('.mat-mdc-snack-bar-label').first())
    .toContainText(message, { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('[campaign-offer] Early bird', () => {
  test.beforeAll(async () => {
    reseedEmulator();
    await seedEarlyBird();
  });

  test('staff activates the early-bird campaign', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /activate/i }).click();
    await waitForDone(page, /campaign is live/i);
  });

  test('a visitor who arrives directly pays the full price', async ({ page }) => {
    // No campaign link, no attribution, no discount - even though the offer is
    // live and names this very event.
    expect(await eventPageText(page)).toContain(FULL_TOTAL);
  });

  test('a visitor who arrives through the campaign link gets the early-bird price', async ({ page }) => {
    const body = await eventPageText(page, `?cid=${CAMPAIGN_ID}&csrc=email`);

    expect(body).toContain(EARLY_BIRD_TOTAL);
  });

  test('the early-bird price survives leaving the link behind', async ({ page }) => {
    // Attribution is stored, not read from the URL each time - a shopper who
    // clicks through and then navigates around must not lose the price they
    // were promised.
    await eventPageText(page, `?cid=${CAMPAIGN_ID}&csrc=email`);

    // Same context, clean URL.
    expect(await eventPageText(page)).toContain(EARLY_BIRD_TOTAL);
  });

  test('ending the campaign takes the early-bird price away', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /end campaign/i }).click();
    const confirm = page.locator('mat-dialog-actions');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByRole('button', { name: 'OK' }).click();
    await waitForDone(page, /campaign ended/i);

    // Even carrying the campaign link, the offer is over.
    const body = await eventPageText(page, `?cid=${CAMPAIGN_ID}&csrc=email`);
    expect(body).toContain(FULL_TOTAL);
  });
});
