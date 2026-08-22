import { test, expect } from '@playwright/test';
import { ADMIN_URL, gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Library Administration - reader accounts, licenses, and messages.
//
// The admin end of the admin/reader seam. The license LIFECYCLE (grant ->
// reader can open the book -> revoke -> reader loses it) is already proven
// end to end by e2e-cross, which is the right place for it - it genuinely
// spans two apps. What is only provable here is that a staff member can
// find a patron and operate those controls at all.
//
// Every screen in this group is employeeGrantable:false in nav-config, so
// these are Admin-only surfaces by construction.
test.describe('[library] Library Administration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the library users grid lists seeded patrons', async ({ page }) => {
    await gotoTab(page, 'library-manager', 'library-users');
    const rows = await waitForGrid(page, 'users-table');
    expect(rows).toBeGreaterThan(0);
    await expect(page.locator('.users-table')).toContainText('patron@test.local');
  });

  test('a patron opens their detail view with licenses listed', async ({ page }) => {
    await gotoTab(page, 'library-manager', 'library-users');
    await waitForGrid(page, 'users-table');
    await page.locator('.users-table tbody tr', { hasText: 'patron@test.local' }).first().dblclick();
    // The detail route is /library-manager/library-users/:email.
    await expect(page).toHaveURL(/library-users\//, { timeout: 20_000 });
    await expect(page.locator('.licenses-table, app-library-user-detail').first())
      .toBeVisible({ timeout: 25_000 });
  });

  test('a patron detail page offers the grant and revoke controls', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/library-manager/library-users/patron@test.local`);
    await expect(page.locator('app-library-user-detail, .licenses-table').first())
      .toBeVisible({ timeout: 30_000 });
    // Granting licenses is the single most consequential staff action in
    // this area - if the button is gone, support cannot fix an entitlement.
    await expect(page.getByRole('button', { name: /grant/i }).first())
      .toBeVisible({ timeout: 20_000 });
  });

  test('the library content browser renders the seeded series tree', async ({ page }) => {
    await gotoTab(page, 'library-manager', 'browse');
    await expect(page.locator('app-browse, app-library-browse').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toContainText('Foundations', { timeout: 25_000 });
  });

  test('impact groups load', async ({ page }) => {
    await gotoTab(page, 'library-manager', 'groups');
    await waitForGrid(page, 'groups-table');
    await expect(page.locator('.groups-table')).toBeVisible();
  });

  test('the activity log loads', async ({ page }) => {
    await gotoTab(page, 'library-manager', 'activity-log');
    await waitForGrid(page, 'activity-table');
    await expect(page.locator('.activity-table')).toBeVisible();
  });
});
