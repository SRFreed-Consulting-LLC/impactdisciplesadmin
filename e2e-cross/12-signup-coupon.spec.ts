import { test, expect } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: the THANK-YOU COUPON - a campaign rewarding a newsletter
// signup with a discount code, delivered in the confirmation email.
//
// Spans further than any other spec here: a visitor arrives on the public
// site through a campaign link, subscribes, and the code has to reach the
// very email that welcomes them. Between those two points sit attribution
// capture, the subscribe endpoint, a campaign lookup, a coupon lookup and the
// queued mail document - and the whole thing is invisible from either app's
// UI, which is why nothing else was ever going to catch it.
//
// The delivery assertion reads the `mail` collection rather than an inbox:
// the emulator queues mail, it never sends it. That is what 04 does too.

const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

// coupon-save10 is seeded active: code SAVE10, 10% off.
const COUPON_ID = 'coupon-save10';
const COUPON_CODE = 'SAVE10';

const CAMPAIGN_ID = 'camp-coupon-cross';
const RUN = Date.now().toString(36);
const SUBSCRIBER = {
  firstName: 'Coupon',
  lastName: `Aatester${RUN}`,
  email: `coupon-${RUN}@cross.test`,
};

const str = (stringValue: string) => ({ stringValue });
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

async function seedCouponCampaign(): Promise<void> {
  await fsWrite(`campaigns/${CAMPAIGN_ID}`, {
    name: str('Signup Coupon Campaign'),
    goal: str('other'),
    otherKind: str('subscriber-growth'),
    status: str('draft'),
    channels: { arrayValue: { values: [str('email')] } },
    // The campaign POINTS AT a real coupons record - the discount system is
    // never duplicated onto the campaign.
    couponId: str(COUPON_ID),
    schemaVersion: num(2),
  });
}

/** The queued confirmation email for an address, or null. */
async function queuedMailFor(email: string): Promise<string | null> {
  const res = await fetch(`${FS_BASE.replace(/\/documents$/, '')}/documents:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'mail' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'to' },
            op: 'EQUAL',
            value: { stringValue: email },
          },
        },
      },
    }),
  });
  const rows = await res.json() as { document?: { fields?: Record<string, never> } }[];
  const doc = rows.find((r) => r.document)?.document;
  if (!doc) return null;
  return JSON.stringify(doc.fields ?? {});
}

async function subscribeThroughCampaign(page: import('@playwright/test').Page, query: string): Promise<void> {
  // Landing WITH the campaign link is what makes this a campaign signup -
  // attribution is captured at bootstrap, before the router can wipe it.
  await page.goto(`${WEB_URL}/newsletter${query}`);
  const area = page.locator('.subscribe__area');
  await area.getByPlaceholder('First Name').fill(SUBSCRIBER.firstName);
  await area.getByPlaceholder('Last Name').fill(SUBSCRIBER.lastName);
  await area.getByPlaceholder('Email').fill(SUBSCRIBER.email);
  await area.getByRole('button', { name: 'subscribe' }).click();
  await expect(page.locator('.impact-toast'))
    .toContainText('Subscription added Successfully!', { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('[campaign-offer] Signup coupon', () => {
  test.beforeAll(async () => {
    reseedEmulator();
    await seedCouponCampaign();
  });

  // Signing in per test rather than once: the beforeAll reseed wipes Auth,
  // and a single login racing that recreation put the first test on the
  // login screen once already.
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('staff activates the campaign that carries the coupon', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${CAMPAIGN_ID}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /activate/i }).click();
    await expect(page.locator('.mat-mdc-snack-bar-label').first())
      .toContainText(/campaign is live/i, { timeout: 30_000 });
  });

  test('subscribing through the campaign link delivers the code in the welcome email', async ({ page }) => {
    await subscribeThroughCampaign(page, `?cid=${CAMPAIGN_ID}&csrc=email`);

    // The confirmation is queued server-side by subscribe_to_email_list, and
    // the code has to be IN it - a separate email would be a different feature.
    await expect.poll(() => queuedMailFor(SUBSCRIBER.email), { timeout: 30_000 })
      .toContain(COUPON_CODE);
  });

  test('the welcome email says what the code is worth', async ({ page }) => {
    // Not decoration: a bare code with no percentage is not a thank-you, and
    // the percentage comes from the coupon record rather than the campaign.
    void page;
    const mail = await queuedMailFor(SUBSCRIBER.email);

    expect(mail).toContain('10% off');
  });
});
