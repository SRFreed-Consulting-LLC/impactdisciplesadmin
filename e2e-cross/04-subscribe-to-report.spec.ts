import { test, expect } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: Contacts / Subscribers / Campaigns - a public newsletter
// signup flowing into the Subscribers report and the (cancelled) blast flow.
//
// Reseeds in beforeAll (BEFORE any login): the report/audience assertions
// are absolute counts (6 seeded newsletter subscribers + the 1 this spec
// creates = 7), so a pristine world is genuinely required.
//
// THE CANCEL RULE IS ABSOLUTE: the Send Newsletter flow below is opened
// only far enough to read the audience-count confirmation, then cancelled.
// Nothing is ever confirmed; afterwards the spec proves no campaign_sends
// ledger rows (and no campaign) came into existence.

const FS_ROOT = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)';

const SUB = { firstName: 'Subrina', lastName: 'Flow', email: 'sub-flow@e2e.test' };
const TEST_SUBJECT = 'Cross-suite dry run (never sent)';

// Emulator-owner REST read - proof-of-absence checks only.
async function fsListCollection(collection: string): Promise<any[]> {
  const res = await fetch(`${FS_ROOT}/documents/${collection}?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  });
  const body = await res.json().catch(() => ({}));
  return body.documents ?? [];
}

test.describe.configure({ mode: 'serial' });

test.describe('newsletter subscribe to subscriber report', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('the public subscribe form distinguishes a fresh subscribe from an already-subscribed one', async ({ page }) => {
    // app-subscribe-area renders on /newsletter (newsletter.component.html)
    // - placeholder-labelled inputs + a "subscribe" button
    // (subscribe-area.component.html).
    await page.goto(`${WEB_URL}/newsletter`);
    // Scoped to the subscribe-area section - the page footer carries a
    // second, unrelated "First Name" subscribe form of its own.
    const area = page.locator('.subscribe__area');
    await area.getByPlaceholder('First Name').fill(SUB.firstName);
    await area.getByPlaceholder('Last Name').fill(SUB.lastName);
    await area.getByPlaceholder('Email').fill(SUB.email);
    await area.getByRole('button', { name: 'subscribe' }).click();

    // Fresh subscribe -> success toast (subscribe-area.component.ts).
    await expect(page.locator('.impact-toast')).toContainText('Subscription added Successfully!', { timeout: 30_000 });

    // Same email again -> the server's alreadySubscribed contract surfaces
    // as the distinct info toast (and leaves the count below unchanged).
    // The first toast auto-dismisses after ~3s; wait it out so the second
    // assertion can't match the stale one.
    await expect(page.locator('.impact-toast')).toHaveCount(0, { timeout: 10_000 });
    await area.getByRole('button', { name: 'subscribe' }).click();
    await expect(page.locator('.impact-toast')).toContainText('already subscribed to our Newsletter', { timeout: 30_000 });
  });

  test('the Subscribers report (Type = Newsletter) finds the new subscriber and counts 7', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/reports-manager?tab=subscribers`);

    // Criteria form (subscriber-report.component.html): enable the Type
    // criterion checkbox, pick Newsletter in its mat-select, Generate.
    await page.locator('mat-checkbox', { hasText: 'Type' }).click();
    await page.locator('mat-select[formControlName="type"]').click({ force: true });
    await page.getByRole('option', { name: 'Newsletter', exact: true }).click();
    await page.getByRole('button', { name: 'Generate Report' }).click();

    // 6 seeded newsletter subscribers (casey01-06) + sub-flow = 7. The
    // count renders as ".result-count" ("7 results").
    await expect(page.locator('.result-count')).toHaveText('7 results', { timeout: 30_000 });
    const newRow = page.locator('tr', { hasText: SUB.email });
    await expect(newRow).toBeVisible();
    await expect(newRow).toContainText('Newsletter');
    // Spot-check a seeded subscriber rides along.
    await expect(page.locator('tr', { hasText: 'casey01@contacts.test' })).toBeVisible();
  });

  test('the Send Newsletter confirmation quotes the audience of 7 and cancelling sends nothing', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/reports-manager?tab=subscribers`);

    await page.getByRole('button', { name: 'Send Newsletter' }).click();
    const sendDialog = page.locator('mat-dialog-container', { hasText: 'SEND NEWSLETTER' });
    await expect(sendDialog).toBeVisible();

    // Subject is required before SEND runs the audience preview
    // (send-subscription-dialog.component.ts onSend()).
    await sendDialog.locator('input[formControlName="subject"]').fill(TEST_SUBJECT);
    await sendDialog.getByRole('button', { name: 'SEND', exact: true }).click();

    // The confirm dialog quotes the REAL resolver's count - the same
    // audience resolver send-time uses (previewCampaignAudience). 7 =
    // 6 seeded + the subscriber this spec created.
    const confirmDialog = page.locator('mat-dialog-container', { hasText: 'Confirm Newsletter' });
    await expect(confirmDialog).toBeVisible({ timeout: 30_000 });
    await expect(confirmDialog).toContainText('to 7 newsletter subscriber(s)');

    // CANCEL - never confirm. The confirm happens BEFORE any campaign/
    // touch/ledger write, so cancelling here must leave zero traces.
    await confirmDialog.getByRole('button', { name: 'CANCEL' }).click();
    await expect(confirmDialog).toHaveCount(0);

    // Back in the (still-open) compose dialog: close it too, without
    // any success snackbar ever having appeared.
    await expect(page.getByText(/queued to \d+ recipient/)).toHaveCount(0);
    await sendDialog.getByRole('button', { name: 'CANCEL' }).click();
    await expect(sendDialog).toHaveCount(0);

    // Proof of absence in the ledger: no campaign_sends docs exist at all
    // in this pristine world, and no campaign was created for the subject.
    const sends = await fsListCollection('campaign_sends');
    expect(sends).toHaveLength(0);
    const campaigns = await fsListCollection('campaigns');
    const names = campaigns.map((d) => d.fields?.name?.stringValue ?? '');
    expect(names.some((n) => n.includes(TEST_SUBJECT))).toBe(false);
  });
});
