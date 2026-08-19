import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Validates the harness itself (login flow + a known-good already-migrated
// screen) before it's trusted to verify new work. Contacts is a good
// canary: it exercises app-list-header, the sticky MatTable header, the
// column-filter row, and the loading-spinner overlay all at once.
test('logs in and loads the Contacts list via the left nav', async ({ page }) => {
  await loginAsAdmin(page);

  // Contacts lives under the Contacts Manager group (nee Customers Manager,
  // renamed 2026-08-19; nav-config.ts's 2026-08 reorg had earlier moved it
  // off the old admin-manager module). contacts-manager is a single route
  // (ContactsManagerComponent) that switches between screens client-side via
  // the left nav's collapsible groups, not a per-screen route. Driven via a
  // real group-expand + link-click (not a direct ?tab= URL) so this still
  // exercises the left-nav flow the test name promises.
  await page.goto('/home');
  await page.getByRole('button', { name: 'CONTACTS' }).click();
  await page.getByRole('link', { name: 'Contacts' }).click();

  const table = page.locator('table.contacts-table');
  await expect(table).toBeVisible();

  // The loading overlay is present (in the DOM) only while loading$ is
  // true - see table-loading-overlay.component. It should be gone by the
  // time real data has streamed in.
  await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);

  await expect(page.locator('table.contacts-table thead, table.contacts-table tr.mat-mdc-header-row').first()).toBeVisible();
});
