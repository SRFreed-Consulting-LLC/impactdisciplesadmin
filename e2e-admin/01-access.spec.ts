import { test, expect } from '@playwright/test';
import { ADMIN_URL, EMPLOYEE_EMAIL, PASSWORD, loginAsAdmin } from './support/harness';

// AREA: Access Control - can staff get in, and are Employees kept out of
// what they were never granted.
//
// The seeded world has an Admin (full rights) and an Employee whose
// admin_users doc carries an explicit, narrow `permissions` array
// (emulator-fixtures.js). That asymmetry is the whole point of this file:
// the Employee is the only fixture that can prove PermissionService is
// actually gating rather than just hiding.
test.describe('[access] Access Control', () => {
  test('an unauthenticated visitor is sent to the login screen', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/campaigns-manager`);
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('bad credentials are refused and do not open the app', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await page.fill('input[type="email"]', 'admin@test.local');
    await page.fill('input[type="password"]', 'definitely-not-the-password');
    await page.click('button[type="submit"]');
    // Still on /login a beat later - the app must not navigate on failure.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/login/);
  });

  test('the seeded admin signs in and lands on the app shell', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('.impact-header__user')).toBeVisible({ timeout: 20_000 });
  });

  test('an Employee cannot reach Admin Users, by URL or otherwise', async ({ page }) => {
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    // hideFromNav + employeeGrantable:false in nav-config.ts - this is the
    // self-escalation door (an Employee who could edit admin_users could
    // grant themselves anything), so a direct URL must not open it.
    await page.goto(`${ADMIN_URL}/admin-manager?tab=admin-users`);
    await page.waitForTimeout(4000);
    await expect(page.locator('app-admin-users')).toHaveCount(0);
  });

  test('the left nav shows an Employee only their granted screens', async ({ page }) => {
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    await page.goto(`${ADMIN_URL}/home`);
    await expect(page.locator('.impact-header__user')).toBeVisible({ timeout: 20_000 });
    // Admin Manager is never a visible group for anyone (both its items are
    // hideFromNav) - if it renders for an Employee, secureNav is broken.
    await expect(page.getByRole('button', { name: 'ADMIN MANAGER', exact: true })).toHaveCount(0);
  });

  test('signing out returns to login and the session does not survive it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.locator('.impact-header__user').click();
    await page.getByRole('menuitem', { name: 'Log Off' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    // Back-navigating to a protected route must not restore the session.
    await page.goto(`${ADMIN_URL}/campaigns-manager`);
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });
});
