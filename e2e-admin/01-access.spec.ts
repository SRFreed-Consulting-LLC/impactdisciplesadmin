import { test, expect } from '@playwright/test';
import { ADMIN_URL, EMPLOYEE_EMAIL, loginAsAdmin } from './support/harness';

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

  // THE SITE TAB, DELEGATED BY SCREEN (2026-09-03). The fixture Employee
  // holds exactly three grants: one page (Coaching with Impact), one Site
  // record list (Disciple Making Minute) and one back-office screen (Website
  // Newsletters). Each assertion below pairs what they CAN see with a
  // neighbour they must NOT - the neighbour is the half that fails if the
  // gate ever widens from "this screen" back to "this tab".
  test('an Employee granted one page sees that page on the Site tab, and no other', async ({ page }) => {
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    await page.goto(`${ADMIN_URL}/home`);
    await expect(page.locator('.impact-header__user')).toBeVisible({ timeout: 20_000 });

    // The tab exists for them at all - it was Admin/Root only before.
    await page.getByRole('radio', { name: 'Site' }).click();
    await page.getByRole('button', { name: 'PAGES', exact: true }).click();
    // Nav LEAVES are links - by role, because the dashboard behind the
    // drawer has its own "Home" heading and would match by text.
    await expect(page.getByRole('link', { name: 'Coaching with Impact', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'About Us', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);

    // And the editor itself refuses a page they were not granted: a typed
    // URL for About Us opens the editor on the granted page - the URL is
    // left as typed (TabShell selects, it does not rewrite), so the proof
    // is the editor's own slug crumb.
    await page.goto(`${ADMIN_URL}/page-manager?tab=about-us`);
    await expect(page.locator('.kp__slug')).toHaveText('/coaching-with-impact', { timeout: 20_000 });
  });

  test('an Employee\'s Home is the screens they hold - no orders, events or requests they cannot open', async ({ page }) => {
    // Home used to render Recent Orders (customer names), Upcoming Events
    // and New Requests to every Employee regardless of grants - it has no
    // screen key of its own. Each preview is gated on the screen it belongs
    // to now, and an Employee gets a list of their screens instead.
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    await page.goto(`${ADMIN_URL}/home`);
    const mine = page.locator('[data-e2e="my-screens"]');
    await expect(mine).toBeVisible({ timeout: 20_000 });
    await expect(mine.getByRole('link', { name: /Coaching with Impact/ })).toBeVisible();
    await expect(mine.getByRole('link', { name: /Disciple Making Minute/ })).toBeVisible();
    await expect(mine.getByRole('link', { name: /Website Newsletters/ })).toBeVisible();
    await expect(mine.getByRole('link')).toHaveCount(3);
    await expect(page.getByText('Recent Orders')).toHaveCount(0);
    await expect(page.getByText('Upcoming Events')).toHaveCount(0);
    await expect(page.getByText('New Requests')).toHaveCount(0);

    // And the Admin's Home is unchanged: all three previews, no list.
    await page.locator('.impact-header__user').click();
    await page.getByRole('menuitem', { name: 'Log Off' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/home`);
    await expect(page.getByText('Recent Orders')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Upcoming Events')).toBeVisible();
    await expect(page.getByText('New Requests')).toBeVisible();
    await expect(page.locator('[data-e2e="my-screens"]')).toHaveCount(0);
  });

  test('an Employee granted one Site record list sees it, and not the lists beside it', async ({ page }) => {
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    await page.goto(`${ADMIN_URL}/data?tab=disciple-making-minute`);
    await expect(page.locator('app-dmms')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('app-products')).toHaveCount(0);

    // Products sits in the same DATA group; a typed URL must not open it.
    await page.goto(`${ADMIN_URL}/data?tab=products`);
    await page.waitForTimeout(3000);
    await expect(page.locator('app-products')).toHaveCount(0);
  });

  test('an Employee granted one back-office screen sees only it under its group', async ({ page }) => {
    await loginAsAdmin(page, EMPLOYEE_EMAIL);
    await page.goto(`${ADMIN_URL}/home`);
    await expect(page.locator('.impact-header__user')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'CAMPAIGNS', exact: true }).click();
    // Scoped to the drawer: Home's own "Your screens" list names the same
    // screen, so an unscoped text match resolves twice.
    const drawer = page.getByRole('navigation');
    await expect(drawer.getByRole('link', { name: 'Website Newsletters', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(drawer.getByRole('link', { name: 'Campaigns', exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('link', { name: 'Tag Rules', exact: true })).toHaveCount(0);
    // Nothing granted under CONTACTS, so the group is not offered at all.
    await expect(page.getByRole('button', { name: 'CONTACTS', exact: true })).toHaveCount(0);
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
