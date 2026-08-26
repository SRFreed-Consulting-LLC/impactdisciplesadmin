import { test, expect } from '@playwright/test';
import { ADMIN_URL, ADMIN_EMAIL, EMPLOYEE_EMAIL, dataRows, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Staff Administration - the screen where access itself is granted.
//
// 01-access.spec.ts already proves an Employee CANNOT reach Admin Users. It
// says nothing about whether an Admin can: the negative passes just as
// happily when the screen is broken for everyone. That asymmetry is the gap
// this file closes - if Admin Users stopped rendering, nobody could add or
// change staff and the suite would stay green.
//
// Read-only. Granting and revoking a real permission would change what the
// OTHER specs in this suite are allowed to see (01-access leans on the
// Employee's narrow permissions array), and the suite shares one seeded
// world - so this asserts the screen and its controls, not a write.
test.describe('[admin-users] Staff Administration', () => {
  test('an Admin can open Admin Users and sees the seeded staff', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/admin-manager?tab=admin-users`);

    await expect(page.locator('app-admin-users')).toBeVisible({ timeout: 30_000 });
    await waitForGrid(page, 'admin-users-table');

    // POLL rather than trusting waitForGrid's return: its contract is to
    // resolve on the FIRST data row, so reading the count straight after it
    // races a grid still filling in. That passed alone and failed inside the
    // full suite, which is the worst way to find out.
    await expect.poll(() => dataRows(page, 'admin-users-table').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
  });

  test('both seeded staff accounts are listed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/admin-manager?tab=admin-users`);
    await waitForGrid(page, 'admin-users-table');

    const table = page.locator('.admin-users-table');
    await expect(table).toContainText(ADMIN_EMAIL);
    await expect(table).toContainText(EMPLOYEE_EMAIL);
  });

  test('the screen offers a way to add a staff member', async ({ page }) => {
    // Without this the only route to granting access is editing Firestore by
    // hand. Asserted, deliberately not clicked through to a write.
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/admin-manager?tab=admin-users`);
    await waitForGrid(page, 'admin-users-table');

    const add = page.getByRole('button', { name: /add|new|create/i }).first();
    await expect(add).toBeVisible({ timeout: 20_000 });
  });

  test('an existing staff member opens for editing', async ({ page }) => {
    // The permissions array lives behind this row action; if opening a staff
    // member stopped working, access could be read but never changed.
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/admin-manager?tab=admin-users`);
    await waitForGrid(page, 'admin-users-table');

    const row = page.locator('tr', { hasText: EMPLOYEE_EMAIL }).first();
    await expect(row).toBeVisible();
    await row.locator('button').first().click();

    // A dialog, a form, or an inline editor - any of them proves the row
    // action is wired; asserting one specific shape would pin the UI.
    await expect(
      page.locator('mat-dialog-container, form, app-admin-user-form').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('the Logs tab in the same manager still renders', async ({ page }) => {
    // Admin Manager has two screens and one shared tab resolver; a broken
    // slug lookup shows the "no access" state instead of the screen, which
    // looks like a permissions problem rather than a routing one.
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/admin-manager?tab=logs`);

    await expect(page.locator('app-log-messages')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.no-access-state')).toHaveCount(0);
  });
});
