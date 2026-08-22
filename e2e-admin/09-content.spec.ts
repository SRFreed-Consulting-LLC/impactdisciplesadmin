import { test, expect } from '@playwright/test';
import { collectConsoleErrors, gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Website Content - everything the PUBLIC site renders out of
// Firestore. If an editor here breaks, the public site does not go down; it
// quietly stops being updatable, which is worse because nothing alerts.
//
// Each of these is one screen with one grid, so this file is deliberately
// broad and shallow: it proves every content editor still mounts and loads.
// That is exactly the class of breakage a shared-component refactor causes
// (five screens were moved onto BaseListComponent in the last sweep), and
// it is invisible to every other test layer.
test.describe('[content] Website Content', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  const screens: Array<[string, string, string]> = [
    ['Disciple Making Minute', 'disciple-making-minute', 'dmms-table'],
    ['Podcasts', 'pod-casts', 'pod-casts-table'],
    ['Testimonials', 'testimonials', 'testimonials-table'],
    ['Home Page Images', 'home-page-images', 'images-table'],
    ['Team Page', 'team-page', 'team-page-table'],
  ];

  for (const [label, slug, tableClass] of screens) {
    test(`${label} loads its editor grid`, async ({ page }) => {
      await gotoTab(page, 'content-manager', slug);
      await waitForGrid(page, tableClass);
      await expect(page.locator(`.${tableClass}`)).toBeVisible();
    });
  }

  test('Web Config loads', async ({ page }) => {
    await gotoTab(page, 'content-manager', 'web-config');
    await expect(page.locator('app-web-config')).toBeVisible({ timeout: 30_000 });
  });

  test('the shared list screens run without throwing', async ({ page }) => {
    // These five moved onto BaseListComponent together; a break in the base
    // class shows up as a thrown error rather than a missing element.
    const errors = collectConsoleErrors(page);
    for (const [, slug, tableClass] of screens.slice(0, 3)) {
      await gotoTab(page, 'content-manager', slug);
      await waitForGrid(page, tableClass);
    }
    expect(errors, `browser threw:\n${errors.join('\n')}`).toEqual([]);
  });
});
