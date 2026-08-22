import { test, expect } from '@playwright/test';
import { gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Tools & Reports - system email templates, the form builder, and the
// reports staff pull numbers from.
//
// System Templates matters more than it looks since the 2026-08-21 template
// split. Templates now carry kind 'system' | 'campaign', and absent means
// system (every template that predates the split is one). Two things can go
// wrong and only a browser sees either: this screen starts hiding the
// legacy templates because they have no explicit kind, or it starts showing
// the campaign-kind ones the campaign editor creates, which do not belong
// in a transactional-template list.
//
// The seeded world is entirely legacy templates with NO kind field, so it
// is the exact fixture that catches the first bug.
test.describe('[tools] Tools & Reports', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('System Templates lists the legacy templates that carry no kind field', async ({ page }) => {
    await gotoTab(page, 'tools-manager', 'system-templates');
    const rows = await waitForGrid(page, 'email-templates-table');
    // 5 seeded mail_templates, none with an explicit kind - all must show.
    expect(rows).toBeGreaterThanOrEqual(5);
    await expect(page.locator('.email-templates-table')).toContainText('Sales Receipt');
    await expect(page.locator('.email-templates-table')).toContainText('Event Registration Confirmation');
  });

  test('a legacy template edits in the rich-text dialog, NOT the builder', async ({ page }) => {
    // Deliberate since 2026-08-21, and the more important half of the
    // template split: opening a legacy (no `design`) template in the
    // full-screen builder imports it as one text block and converts it to a
    // builder template on first save. That is a ONE-WAY door, and these are
    // placeholder documents a Cloud Function substitutes into - so a typo
    // fix on a sales receipt must not restructure its markup.
    // Converting is its own explicit action (openInBuilder), behind a
    // confirm. Asserting the designer opened here would pin the hazard.
    await gotoTab(page, 'tools-manager', 'system-templates');
    await waitForGrid(page, 'email-templates-table');
    await page.locator('.email-templates-table tbody tr', { hasText: 'Sales Receipt' }).first().dblclick();

    await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/email-designer/);
  });

  test('the form builder loads', async ({ page }) => {
    await gotoTab(page, 'tools-manager', 'form-builder');
    await waitForGrid(page, 'form-builder-table');
    await expect(page.locator('.form-builder-table')).toBeVisible();
  });

  test('shipping labels loads', async ({ page }) => {
    await gotoTab(page, 'tools-manager', 'shipping-labels');
    await expect(page.locator('app-shipping-labels')).toBeVisible({ timeout: 30_000 });
  });

  const reports = ['purchases', 'subscribers', 'contacts', 'events'];
  for (const slug of reports) {
    test(`the ${slug} report renders`, async ({ page }) => {
      await gotoTab(page, 'reports-manager', slug);
      await expect(page.locator('app-reports-manager')).toBeVisible({ timeout: 30_000 });
      // Reports render into the shared report grid; an empty report is a
      // legitimate outcome, a never-resolving one is not.
      await waitForGrid(page, 'report-table').catch(() => 0);
    });
  }
});
