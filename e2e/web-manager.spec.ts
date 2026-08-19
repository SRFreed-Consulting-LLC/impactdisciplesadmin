import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Web Manager is a single route (WebManagerComponent) that switches between
// screens client-side via the left nav's ?tab= query param (see
// nav-config.ts), not a per-screen route or a tab bar - see
// web-manager-routing.module.ts. Slugs here must match nav-config.ts's
// 'web-manager' group. (The Home Page Popups screen and its round-trip
// test were retired 2026-08-19 - web-campaign popups own that space now,
// covered by campaigns.spec.ts.)
const TAB_SLUGS: Record<string, string> = {
  'Disciple Making Minute': 'disciple-making-minute',
  'Pod Casts': 'pod-casts',
  'Home Page Images': 'home-page-images'
};

async function openWebManagerTab(page: import('@playwright/test').Page, tabName: string) {
  await page.goto(`/web-manager?tab=${TAB_SLUGS[tabName]}`);
}

test.describe('Web Manager - read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Disciple Making Minute list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Disciple Making Minute');

    await expect(page.locator('table.dmms-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home Page Images list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Home Page Images');

    await expect(page.locator('table.images-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Pod Casts list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Pod Casts');

    await expect(page.locator('table.pod-casts-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });
});
