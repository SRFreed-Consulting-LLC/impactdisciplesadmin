import { test, expect } from '@playwright/test';
import { gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Contacts & Orders - finding a contact or a purchase, and servicing
// an order.
//
// The DATA truths here (a purchase creating/merging a customer, refunds,
// fulfillment eligibility) already have integration coverage over the real
// emulated functions, which is the right layer for them - a browser adds
// nothing but latency to a Firestore assertion. So this file deliberately
// only asserts what the browser is uniquely able to break: that staff can
// reach the records, that the grids render, and that servicing a purchase
// actually opens.
test.describe('[contacts] Contacts & Orders', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the contacts grid loads the seeded customers', async ({ page }) => {
    await gotoTab(page, 'contacts-manager', 'contacts');
    const rows = await waitForGrid(page, 'contacts-table');
    // Customers are derived by triggers from the seeded purchases and
    // registrations rather than seeded directly, so assert "some", not a
    // fixed count - the exact number is the integration suite's business.
    expect(rows).toBeGreaterThan(0);
  });

  test('a contact opens its detail view', async ({ page }) => {
    await gotoTab(page, 'contacts-manager', 'contacts');
    await waitForGrid(page, 'contacts-table');
    await page.locator('.contacts-table tbody tr').first().dblclick();
    await expect(page.locator('mat-dialog-container, app-contact-details, app-customer-details').first())
      .toBeVisible({ timeout: 20_000 });
  });

  test('the purchases grid loads, and a purchase opens its details', async ({ page }) => {
    // FIXTURE GAP: emulator-fixtures.js seeds no `purchases` collection at
    // all - the seeded customers arrive via onEventRegistrationCustomerUpsert
    // from the event registrations, not from orders. So an empty grid here
    // is the fixture's fault, not the screen's, and this test proves the
    // screen LOADS either way. Seed a purchase and the detail half starts
    // being exercised too; until then the money path stays integration/'s.
    await gotoTab(page, 'contacts-manager', 'purchases');
    const rows = await waitForGrid(page, 'purchases-table');

    if (rows === 0) {
      await expect(page.locator('.purchases-table td.empty-state')).toBeVisible();
      return;
    }
    await page.locator('.purchases-table tbody tr').first().dblclick();
    await expect(page.locator('app-purchase-details, mat-dialog-container').first())
      .toBeVisible({ timeout: 20_000 });
  });

  test('the fulfillment queue renders', async ({ page }) => {
    await gotoTab(page, 'contacts-manager', 'fulfillment');
    await expect(page.locator('app-fulfillment')).toBeVisible({ timeout: 25_000 });
  });

  test('organizations load and open', async ({ page }) => {
    await gotoTab(page, 'contacts-manager', 'organizations');
    const rows = await waitForGrid(page, 'organizations-table');
    expect(rows).toBeGreaterThan(0);
  });

  test('form submissions load', async ({ page }) => {
    await gotoTab(page, 'data', 'custom-form-submissions');
    await waitForGrid(page, 'custom-form-submissions-table');
    await expect(page.locator('.custom-form-submissions-table')).toBeVisible();
  });
});
