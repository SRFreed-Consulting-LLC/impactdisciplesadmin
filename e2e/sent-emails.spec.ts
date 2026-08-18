import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Campaigns Manager > Sent Emails - the global email LOG (Campaign
// Manager v2): every campaign_emails touch across every campaign, newest
// first. Read-only surface: paged rows with engagement stats, a preview
// dialog, and an open-in-designer jump that seeds a COPY.
test.describe('Sent Emails', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/campaigns-manager?tab=sent-emails');
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
    await expect.poll(frameText, { timeout: 10000 }).toBeGreaterThan(500);
  });

  test('open in designer seeds a copy on /new with the html block', async ({ page }) => {
    const firstRow = page.locator('.sent-emails-table tbody tr').first();
    await firstRow.waitFor();
    await firstRow.locator('button:has(mat-icon:text("brush"))').click();

    // Doc ids are mc_<id> for imports and auto-ids for our own sends.
    await expect(page).toHaveURL(/email-designer\/new\?fromEmail=./);
    await expect(page.locator('.html-view').first()).toBeVisible({ timeout: 15000 });
  });
});
