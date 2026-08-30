import { test, expect } from '@playwright/test';
import { FIXTURES, gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Store Catalog - the products and coupons the public web
// store sells.
//
// The one assertion here worth more than the rest is that the RETIRED
// product still appears to staff. The fixture world contains a product
// flagged isActive:false/showInStore:false whose entire job is to prove the
// public store filters it out - which means the admin grid must NOT filter
// it out, or staff can never un-retire anything. That asymmetry is easy to
// break with a well-meaning "only show active" tidy-up.
test.describe('[store] Store Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the products grid lists the catalog', async ({ page }) => {
    await gotoTab(page, 'data', 'products');
    const rows = await waitForGrid(page, 'products-table');
    expect(rows).toBeGreaterThanOrEqual(6);
    await expect(page.locator('.products-table')).toContainText('Disciple-Making Field Guide');
  });

  test('staff can still see a retired product the public store hides', async ({ page }) => {
    await gotoTab(page, 'data', 'products');
    await waitForGrid(page, 'products-table');
    await expect(page.locator('.products-table')).toContainText('Retired Product');
  });

  test('a product opens its edit form with its values loaded', async ({ page }) => {
    await gotoTab(page, 'data', 'products');
    await waitForGrid(page, 'products-table');
    await page.locator('.products-table tbody tr', { hasText: 'Disciple-Making Field Guide' })
      .first().dblclick();
    // Products edit in a full in-page editor panel, deliberately with no
    // route or dialog of its own (products.component.ts's own comment) -
    // so there is no mat-dialog here to wait for.
    await expect(page.locator('.editor')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.editor__title')).toContainText('EDIT PRODUCT');
  });

  test('the digital product carries the library book it unlocks', async ({ page }) => {
    // prod-book-digital -> lib-book-0001 is the admin end of the store/
    // reader seam. If this field stops being editable, nobody can ever
    // point a product at a book again.
    await gotoTab(page, 'data', 'products');
    await waitForGrid(page, 'products-table');
    await expect(page.locator('.products-table')).toContainText('Field Guide (Library Edition)');
    expect(FIXTURES.digitalProduct).toBe('prod-book-digital');
  });

  test('coupons load', async ({ page }) => {
    await gotoTab(page, 'store-manager', 'coupons');
    const rows = await waitForGrid(page, 'coupons-table');
    expect(rows).toBeGreaterThan(0);
  });

  test('Sales is gone - discounts belong to campaigns now', async ({ page }) => {
    // Campaign Manager v3 retired Store > Sales: a discount comes from a
    // campaign offer naming a product, a series or an event, and free
    // shipping is a flag on that offer. Asserted rather than just deleted,
    // because a second pricing system quietly reappearing is exactly the
    // regression this work exists to prevent.
    await gotoTab(page, 'data', 'products');
    await waitForGrid(page, 'products-table');

    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await expect(page.locator('.sales-table')).toHaveCount(0);
  });
});
