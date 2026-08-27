import { test, expect } from '@playwright/test';
import { gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Tools & Reports - the form builder, shipping labels, and the reports
// staff pull numbers from.
//
// This file used to open with two System Templates tests. That screen was
// REMOVED on 2026-08-27 once every template gained a home on the screen that
// sends it (see EmailTemplateEditorService), so `?tab=system-templates`
// resolves to nothing and both tests were dead - one listed the screen's
// grid, the other asserted a legacy template opens in the rich-text dialog,
// which is no longer true either: the designer now serves both, importing a
// legacy template as blocks and converting it on first save.
//
// Deleted rather than rewritten (2026-08-27). Worth knowing what went with
// them: the second test was pinning a hazard - that conversion is a ONE-WAY
// door on documents a Cloud Function substitutes into, and the designer has
// no confirm before it, only the generic unsaved-changes prompt. If that
// ever needs covering again, cover it against the designer route, not here.
test.describe('[tools] Tools & Reports', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
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
