import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Campaign Manager v2, Phase 1: the campaigns list (all campaigns incl.
// the regrouped Mailchimp history), the campaign DETAIL view (funnel +
// touches timeline), and the Status Board lenses over the same docs.
test.describe('Campaign Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/campaigns-manager?tab=campaigns');
    await page.locator('.campaigns-table').waitFor();
  });

  test('list shows the regrouped history with kind chips and funnel stats', async ({ page }) => {
    // 78 campaigns post-regroup; the first page holds 50.
    await expect
      .poll(() => page.locator('.campaigns-table tbody tr:not(:has(.empty-state))').count(), { timeout: 15000 })
      .toBe(50);
    // Kind chips render (the big series are OTHER-kind labels).
    await expect(page.locator('.campaigns-table .chip').first()).toBeVisible();
  });

  test('row opens the campaign detail with funnel and touches timeline', async ({ page }) => {
    // The regrouped series rows have many touches - open the first row.
    const firstRow = page.locator('.campaigns-table tbody tr').first();
    await firstRow.waitFor();
    await firstRow.dblclick();

    await expect(page.locator('app-campaign-detail')).toBeVisible();
    // Funnel tiles: at least Sent / Opened / Clicked render with numbers.
    expect(await page.locator('.funnel__tile').count()).toBeGreaterThanOrEqual(5);
    // Touches load from campaign_emails (composite index campaignId+sentAt).
    await expect
      .poll(() => page.locator('.touch').count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    // A touch previews the real sent email in the sandboxed frame.
    await page.locator('.touch').first().locator('button:has(mat-icon:text("visibility"))').click();
    const frameLen = () =>
      page
        .locator('app-sent-email-preview-dialog iframe')
        .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerHTML?.length ?? 0);
    await expect.poll(frameLen, { timeout: 10000 }).toBeGreaterThan(500);
    await page.locator('app-sent-email-preview-dialog button:has(mat-icon:text("close"))').click();

    // Back returns to the list and clears the deep-link param.
    await page.locator('app-campaign-detail button:has(mat-icon:text("arrow_back"))').click();
    await expect(page.locator('.campaigns-table')).toBeVisible();
  });

  test('detail deep link via ?campaignId= works on a cold load', async ({ page }) => {
    await page.goto('/campaigns-manager?tab=campaigns&campaignId=grp_prayer-letter');
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.detail-header__name')).toHaveText('Prayer Letter');
  });

  test('status board renders board and calendar lenses', async ({ page }) => {
    await page.goto('/campaigns-manager?tab=status-board');
    // All history is ended - the Ended column caps at 2 cards + a view-all link.
    await expect(page.locator('.kanban')).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.locator('.kcard').count())
      .toBeGreaterThanOrEqual(1);

    await page.locator('mat-button-toggle[value="calendar"]').click();
    await expect(page.locator('.calendar')).toBeVisible();
  });
});
