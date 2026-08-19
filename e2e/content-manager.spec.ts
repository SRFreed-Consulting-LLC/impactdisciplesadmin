import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Content Manager (nee Web Manager, renamed 2026-08-19) is a single route (ContentManagerComponent) that switches between
// screens client-side via the left nav's ?tab= query param (see
// nav-config.ts), not a per-screen route or a tab bar - see
// content-manager-routing.module.ts. Slugs here must match nav-config.ts's
// 'content-manager' group. (The Home Page Popups screen and its round-trip
// test were retired 2026-08-19 - web-campaign popups own that space now,
// covered by campaigns.spec.ts.)
const TAB_SLUGS: Record<string, string> = {
  'Disciple Making Minute': 'disciple-making-minute',
  'Pod Casts': 'pod-casts',
  'Home Page Images': 'home-page-images'
};

async function openContentManagerTab(page: import('@playwright/test').Page, tabName: string) {
  await page.goto(`/content-manager?tab=${TAB_SLUGS[tabName]}`);
}

test.describe('Content Manager - read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Disciple Making Minute list renders', async ({ page }) => {
    await openContentManagerTab(page, 'Disciple Making Minute');

    await expect(page.locator('table.dmms-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home Page Images list renders', async ({ page }) => {
    await openContentManagerTab(page, 'Home Page Images');

    await expect(page.locator('table.images-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Pod Casts list renders', async ({ page }) => {
    await openContentManagerTab(page, 'Pod Casts');

    await expect(page.locator('table.pod-casts-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });
});
