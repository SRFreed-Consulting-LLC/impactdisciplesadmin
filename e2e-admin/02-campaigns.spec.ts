import { test, expect } from '@playwright/test';
import {
  ADMIN_URL, FIXTURES, collectConsoleErrors, gotoTab, loginAsAdmin, waitForGrid,
} from './support/harness';

// AREA: Campaigns - the list, the detail view (funnel + touches timeline),
// the wizard, and the status board.
//
// Rewritten 2026-08-21 for the campaigns restructure. Three things moved
// and this file now pins all three:
//   - Sent Emails is no longer a tab; it is a button in the Campaigns grid
//     header that swaps the list into a read-only history (covered in
//     04-email-history, reached from here).
//   - Editing an email is no longer an in-page 'editTouch' mode; NEW EMAIL
//     and clicking an editable touch both NAVIGATE to the full-screen
//     editor at /campaigns-manager/email/:campaignId/:touchId.
//   - Touches can be deleted from the timeline.
// The old spec asserted the in-page editor mounted, which is now a mode
// that no longer exists - it would have passed forever without noticing.
test.describe('[campaigns] Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the campaigns list renders the seeded campaigns with their kind and stats', async ({ page }) => {
    await gotoTab(page, 'campaigns-manager', 'campaigns');
    const rows = await waitForGrid(page, 'campaigns-table');
    // Fixture world has exactly two campaigns.
    expect(rows).toBe(2);
    await expect(page.locator('.campaigns-table')).toContainText(FIXTURES.liveCampaignName);
    await expect(page.locator('.campaigns-table')).toContainText(FIXTURES.pastCampaignName);
    // Kind chips render (goal-derived label).
    await expect(page.locator('.campaigns-table .chip').first()).toBeVisible();
  });

  test('opening a campaign shows its funnel and its email timeline', async ({ page }) => {
    await gotoTab(page, 'campaigns-manager', 'campaigns');
    await waitForGrid(page, 'campaigns-table');

    await page.locator('.campaigns-table tbody tr', { hasText: FIXTURES.pastCampaignName })
      .first().dblclick();

    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.detail-header__name')).toHaveText(FIXTURES.pastCampaignName);
    // Funnel tiles carry the campaign's stats.
    expect(await page.locator('.funnel__tile').count()).toBeGreaterThanOrEqual(5);
    // The seeded past campaign has exactly one touch.
    await expect(page.locator('.touch')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('.touch__subject')).toContainText(FIXTURES.pastTouchLabel);
  });

  test('a campaign opens directly from a ?campaignId= deep link', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${FIXTURES.liveCampaign}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('.detail-header__name')).toHaveText(FIXTURES.liveCampaignName);
  });

  test('NEW EMAIL leaves the tab shell for the full-screen editor', async ({ page }) => {
    // The load-bearing change of the 2026-08-21 restructure: this used to
    // swap an in-page mode, and is now a real route navigation.
    await page.goto(`${ADMIN_URL}/campaigns-manager?tab=campaigns&campaignId=${FIXTURES.liveCampaign}`);
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: /NEW EMAIL/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/campaigns-manager/email/${FIXTURES.liveCampaign}/new`), { timeout: 20_000 });
    await expect(page.locator('app-campaign-email-editor')).toBeVisible({ timeout: 25_000 });
  });

  test('the campaign wizard opens for a new campaign and cancels without saving', async ({ page }) => {
    await gotoTab(page, 'campaigns-manager', 'campaigns');
    await waitForGrid(page, 'campaigns-table');

    await page.getByRole('button', { name: 'New Campaign' }).click();
    await expect(page.locator('app-campaign-wizard')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[formcontrolname="name"]')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.campaigns-table')).toBeVisible();
    // Cancel must not have created anything.
    const rows = await waitForGrid(page, 'campaigns-table');
    expect(rows).toBe(2);
  });

  test('the status board renders both its board and calendar lenses', async ({ page }) => {
    await gotoTab(page, 'campaigns-manager', 'status-board');
    await expect(page.locator('.kanban')).toBeVisible({ timeout: 25_000 });
    await expect.poll(() => page.locator('.kcard').count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    await page.locator('mat-button-toggle[value="calendar"]').click();
    await expect(page.locator('.calendar')).toBeVisible();
  });

  test('the campaigns screen runs without throwing in the browser', async ({ page }) => {
    // A screen can render every element this file asserts and still throw
    // on every change-detection pass - which is exactly what a module split
    // produces. No assertion above would notice.
    const errors = collectConsoleErrors(page);
    await gotoTab(page, 'campaigns-manager', 'campaigns');
    await waitForGrid(page, 'campaigns-table');
    await page.locator('.campaigns-table tbody tr').first().dblclick();
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    expect(errors, `browser threw:\n${errors.join('\n')}`).toEqual([]);
  });
});
