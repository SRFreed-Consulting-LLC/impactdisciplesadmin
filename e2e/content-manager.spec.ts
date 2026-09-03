import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Live-dev smoke over the site-content screens. Each is a single route that
// switches screens client-side via the left nav's ?tab= query param (see
// nav-config.ts), not a per-screen route - so the GROUP id is the route and
// the leaf slug is the tab. Slugs here must match nav-config.ts.
//
// This file described the pre-2026-08-29 layout until 2026-09-03 and had
// been red on every run since the screens moved; the emulator suite
// (e2e-admin/09-content.spec.ts) was corrected the same day the screens
// moved, this one was not. Where things went:
//   - Disciple Making Minute: Page Manager -> DATA (2026-08-31). A list of
//     records, not a page's own words.
//   - Home: its bespoke screen (app-page-home) is DELETED (2026-08-31); it
//     is an ordinary kit page drawn by app-page-stack, and the slider is
//     one List row of that stack whose entries open full screen.
//   - Docking Bar: Web Config tab -> its own leaf under FOOTER (2026-09-01).
//     Site furniture, not a settings form; the leaf IS the screen.
// Retired screens, kept as a record: Home Page Popups (2026-08-19, campaign
// popups own that space), Pod Casts (2026-08-26, only an applePodCast URL
// remains in Web Config), Home Page Images (2026-08-29, the Home slider).

async function gotoTab(page: import('@playwright/test').Page, group: string, slug: string) {
  await page.goto(`/${group}?tab=${slug}`);
}

test.describe('Site content - read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Disciple Making Minute list renders, under DATA', async ({ page }) => {
    await gotoTab(page, 'data', 'disciple-making-minute');

    await expect(page.locator('table.dmms-table')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home is an ordinary kit page, and its slider opens its slides full screen', async ({ page }) => {
    await gotoTab(page, 'page-manager', 'home');

    const stack = page.locator('app-page-stack');
    await expect(stack).toBeVisible({ timeout: 15000 });
    await expect(stack.locator('.ps__section').first()).toBeVisible({ timeout: 15000 });
    // Read nothing, could not read, or a section this build cannot name -
    // Home carries the only `slides` list on the site, so it is the page
    // most likely to drift out of the catalogue unnoticed.
    await expect(stack.locator('.ps__empty')).toHaveCount(0);
    await expect(stack.locator('.ps__failed')).toHaveCount(0);
    await expect(stack.locator('.ps__type-icon--unknown')).toHaveCount(0);

    // A stack row is labelled by its KIND ('List'); Home's first List is the
    // slider. Double-click opens it - the row's only single-click icon is
    // Delete, which the pre-2026-09-03 version of this test clicked.
    const sliderRow = stack.locator('.ps__section', { hasText: 'List' }).first();
    await expect(sliderRow).toBeVisible({ timeout: 15000 });
    await sliderRow.dblclick();

    await expect(page.locator('.ps--editing')).toBeVisible({ timeout: 15000 });
    // The slides themselves, still there and still editable - the one thing
    // the retired `images-table` assertion was actually worth.
    await expect(page.locator('.psd__entry').first()).toBeVisible({ timeout: 15000 });
  });

  test('the Docking Bar editor lives under Footer', async ({ page }) => {
    await gotoTab(page, 'footer', 'docking-bar');
    await expect(page.locator('app-docking-bar')).toBeVisible({ timeout: 15000 });
  });
});
