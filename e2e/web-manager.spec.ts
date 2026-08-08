import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Web Manager is a single route (WebManagerComponent) that tab-switches
// between screens client-side via app-section-tabs, not a per-screen route -
// see web-manager-routing.module.ts.
async function openWebManagerTab(page: import('@playwright/test').Page, tabName: string) {
  await page.goto('/web-manager');
  await page.getByRole('tab', { name: tabName }).click();
}

test.describe('Web Manager - read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('Disciple Making Minute list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Disciple Making Minute');

    await expect(page.locator('table.dmms-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home Page Images list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Home Page Images');

    await expect(page.locator('table.images-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Pod Casts list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Pod Casts');

    await expect(page.locator('table.pod-casts-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });

  test('Home Page Popups list renders', async ({ page }) => {
    await openWebManagerTab(page, 'Home Page Popups');

    await expect(page.locator('table.popups-table')).toBeVisible();
    await expect(page.locator('app-table-loading-overlay .table-loading-overlay')).toHaveCount(0);
  });
});

test.describe('Home Page Popups - full round trip', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // The riskiest screen in this batch: a brand new in-page edit view (no
  // MatDialog), a native datetime-local pair standing in for DevExtreme's
  // combined date+time editor, a custom color swatch+hex input, and a
  // Preview dialog rendering the popup at real size. This is a genuine
  // create -> verify -> delete round trip against the real local Firestore
  // project (same verification standard used throughout this migration) -
  // it cleans up after itself so no test data is left behind.
  test('creates, previews, and deletes a popup via the new in-page editor', async ({ page }) => {
    const title = `E2E Test Popup ${Date.now()}`;

    await openWebManagerTab(page, 'Home Page Popups');

    // "New" is the list's only header action, so app-list-header renders it
    // as a direct button rather than a kebab menu - see list-header.component.
    await page.getByRole('button', { name: 'New' }).click();

    // Confirms the list -> edit view swap actually happened (no dialog, no
    // new URL - just this screen's own content area changing).
    await expect(page.getByText('ADD HOME PAGE POPUP')).toBeVisible();

    const now = new Date();
    const toLocal = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

    await page.locator('input[formcontrolname="fromDate"]').fill(toLocal(now));
    await page.locator('input[formcontrolname="toDate"]').fill(toLocal(inOneHour));
    await page.locator('input[formcontrolname="title"]').fill(title);
    await page.locator('input[formcontrolname="width"]').fill('400');
    await page.locator('input[formcontrolname="height"]').fill('300');

    // Preview should open a real dialog rendering the popup - just confirm
    // it opens and closes cleanly without touching persistence.
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.locator('.preview')).toBeVisible();
    await page.locator('.preview__close').click();
    await expect(page.locator('.preview')).toHaveCount(0);

    await page.getByRole('button', { name: 'SAVE' }).click();

    // Save returns to the list view (no dialog to close) with the new row
    // visible.
    await expect(page.locator('table.popups-table')).toBeVisible();
    const row = page.locator('table.popups-table tr.mat-mdc-row', { hasText: title });
    await expect(row).toBeVisible();

    // Clean up - delete the row this test just created so no test data is
    // left in real Firestore data. The Actions column sits past the
    // right edge of .table-scroll's horizontal scroll area, so scroll it
    // into view explicitly rather than relying on click()'s own
    // auto-scroll (which scrolls the nearest scroll container, not
    // necessarily this one, reliably). Targeted by column class rather
    // than accessible name to sidestep any doubt about how mat-icon's
    // ligature text factors into accname computation.
    const deleteButton = row.locator('td.actions-column button');
    await deleteButton.scrollIntoViewIfNeeded();
    await deleteButton.click();

    // ConfirmDialogComponent's affirmative button is labeled "OK", not
    // "Yes" - see confirm-dialog.component.html.
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('table.popups-table tr', { hasText: title })).toHaveCount(0);
  });
});
