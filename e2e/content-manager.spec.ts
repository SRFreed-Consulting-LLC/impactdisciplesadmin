import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Page Manager (nee Web Manager -> Content Manager -> Page Manager, renamed
// 2026-08-19 and again 2026-08-29) is a single route (PageManagerComponent)
// that switches between screens client-side via the left nav's ?tab= query
// param (see nav-config.ts), not a per-screen route or a tab bar - see
// page-manager-routing.module.ts. Slugs here must match nav-config.ts's
// 'page-manager' group.
//
// Retired screens, kept as a record of why this file is shorter than the
// group: Home Page Popups (2026-08-19, web-campaign popups own that space -
// see campaigns.spec.ts); Pod Casts (2026-08-26, moved to the public web
// app's own component, only an `applePodCast` URL field remains in Web
// Config); and 'Home Page Images' (2026-08-29), which is no longer a screen
// of its own - it is the slider section of HOME.
const TAB_SLUGS: Record<string, string> = {
  'Disciple Making Minute': 'disciple-making-minute',
  'Home': 'home',
  'Web Config': 'web-config'
};

async function openPageManagerTab(page: import('@playwright/test').Page, tabName: string) {
  await page.goto(`/page-manager?tab=${TAB_SLUGS[tabName]}`);
}

test.describe('Page Manager - read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Disciple Making Minute list renders', async ({ page }) => {
    await openPageManagerTab(page, 'Disciple Making Minute');

    await expect(page.locator('table.dmms-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home lists the slider as a section, and its slides open in a dialog', async ({ page }) => {
    // The slides table is IN A DIALOG since 2026-08-29 - the slider became one
    // row of the Home section stack rather than a grid sitting on the screen.
    // This test asserted `table.images-table` was visible on the page itself
    // and had been red ever since; opening the row is the fix, not loosening
    // the assertion.
    await openPageManagerTab(page, 'Home');

    await expect(page.locator('app-page-home')).toBeVisible();
    const sliderRow = page.locator('.home__section', { hasText: 'Slider' }).first();
    await expect(sliderRow).toBeVisible();

    await sliderRow.locator('.home__icon-btn').first().click();

    await expect(page.locator('table.images-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  // The docking bar moved off its own screen onto Web Config on 2026-08-29 -
  // it renders on every page of the public site, so it is site furniture
  // rather than home-page content. Pinned here because an editor that still
  // exists but has moved is the kind of change that goes missing quietly.
  test('the Docking Bar editor lives on Web Config', async ({ page }) => {
    await openPageManagerTab(page, 'Web Config');

    await page.getByRole('tab', { name: 'Docking Bar' }).click();
    await expect(page.locator('app-docking-bar')).toBeVisible();
  });
});
