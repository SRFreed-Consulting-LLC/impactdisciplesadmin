import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Validates the harness itself (login flow + a known-good already-migrated
// screen) before it's trusted to verify new work. Customers is a good
// canary: it exercises app-list-header, the sticky MatTable header, the
// column-filter row, and the loading-spinner overlay all at once.
test('logs in and loads the Customers list via the left nav', async ({ page }) => {
  await loginAsAdmin(page);

  // admin-manager is a single route (AdminManagerComponent) that switches
  // between screens client-side via the left nav's collapsible groups (see
  // nav-config.ts / MainScreenComponent), not a per-screen route - default
  // sub-screen is Logs, so Customers needs an explicit nav click. Landing
  // on this route auto-expands its own group (MainScreenComponent's
  // syncActiveFromUrl), so the Customers link is already visible.
  await page.goto('/admin-manager');
  await page.getByRole('link', { name: 'Customers' }).click();

  const table = page.locator('table.customers-table');
  await expect(table).toBeVisible();

  // The loading overlay is present (in the DOM) only while loading$ is
  // true - see table-loading-overlay.component. It should be gone by the
  // time real data has streamed in.
  await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);

  await expect(page.locator('table.customers-table thead, table.customers-table tr.mat-mdc-header-row').first()).toBeVisible();
});
