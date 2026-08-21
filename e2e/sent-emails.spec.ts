import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Campaigns Manager > Campaigns > "Sent Emails" - the global email LOG
// (Campaign Manager v2): every campaign_emails touch across every
// campaign, newest first. Purely historical since 2026-08-21: paged rows
// with engagement stats, a preview dialog, and a row click that lands on
// that email's campaign. No editing, and no nav leaf of its own - it is
// reached from the button in the Campaigns grid header.
test.describe('Sent Emails', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/campaigns-manager?tab=campaigns');
    await page.locator('.campaigns-table').waitFor();
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await page.locator('.sent-emails-table').waitFor();
  });

  test('lists paged history with engagement stats, newest first', async ({ page }) => {
    // 477 imported docs; the first page holds 50.
    await expect
      .poll(() => page.locator('.sent-emails-table tbody tr:not(:has(.empty-state))').count(), { timeout: 15000 })
      .toBe(50);
    await expect(page.locator('app-paged-table-footer')).toContainText('50 loaded');

    // Newest-first ordering: the first row's Sent date >= the last row's.
    const cellDate = async (row: 'first' | 'last') => {
      const tr = row === 'first' ?
        page.locator('.sent-emails-table tbody tr').first() :
        page.locator('.sent-emails-table tbody tr').last();
      return new Date(await tr.locator('td').nth(2).innerText()).getTime();
    };
    expect(await cellDate('first')).toBeGreaterThanOrEqual(await cellDate('last'));
  });

  test('preview opens the sent email body in a sandboxed frame', async ({ page }) => {
    const firstRow = page.locator('.sent-emails-table tbody tr').first();
    await firstRow.waitFor();
    await firstRow.locator('button:has(mat-icon:text("visibility"))').click();

    const frameText = () =>
      page
        .locator('app-sent-email-preview-dialog iframe')
        .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerHTML?.length ?? 0);
    // Low threshold on purpose - the newest email may be a small
    // hand-authored send rather than a full rendered document.
    await expect.poll(frameText, { timeout: 10000 }).toBeGreaterThan(50);
  });

  // The preview icon must NOT also count as a row click - the grid's row
  // action buttons stopPropagation for exactly this reason.
  test('preview icon does not navigate away from the log', async ({ page }) => {
    const firstRow = page.locator('.sent-emails-table tbody tr').first();
    await firstRow.waitFor();
    await firstRow.locator('button:has(mat-icon:text("visibility"))').click();
    await expect(page.locator('app-sent-email-preview-dialog')).toBeVisible();
    await expect(page.locator('.sent-emails-table')).toBeVisible();
  });

  test('clicking a row opens that email\'s campaign detail', async ({ page }) => {
    const firstRow = page.locator('.sent-emails-table tbody tr').first();
    await firstRow.waitFor();
    // The Campaign column (index 1) names where this row should land.
    const campaignName = (await firstRow.locator('td').nth(1).innerText()).trim();
    await firstRow.locator('td').first().click();

    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/campaignId=./);
    if (campaignName) {
      await expect(page.locator('.detail-header__name')).toHaveText(campaignName);
    }
  });
});
