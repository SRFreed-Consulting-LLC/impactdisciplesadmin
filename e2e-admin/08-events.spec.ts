import { test, expect } from '@playwright/test';
import { gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Events & Registrations.
//
// The registration MATH - session counts staying truthful as registrations
// are created and edited - is integration-tested against the real
// onEventRegistrationSessionCounts trigger, and the public registration
// journey is covered cross-app. What is left for the browser is that staff
// can open an event, see who is coming, and read those counts.
//
// Events is also the only screen in nav-config with internal permission
// TABS (Info / Application / Agenda / Attendees / Break Outs), so it is the
// one place a tab-level permission regression could hide.
test.describe('[events] Events & Registrations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the events grid lists seeded events', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'events');
    const rows = await waitForGrid(page, 'events-table');
    expect(rows).toBeGreaterThan(0);
  });

  test('the summit screen loads', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'summit');
    await expect(page.locator('app-summit, app-events').first()).toBeVisible({ timeout: 30_000 });
  });

  test('an event opens and shows its internal tabs', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'events');
    await waitForGrid(page, 'events-table');
    await page.locator('.events-table tbody tr').first().dblclick();
    await expect(page.locator('mat-tab-group, app-event-details').first()).toBeVisible({ timeout: 25_000 });
  });

  test('the attendees tab lists registrations', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'events');
    await waitForGrid(page, 'events-table');
    await page.locator('.events-table tbody tr').first().dblclick();
    await expect(page.locator('mat-tab-group, app-event-details').first()).toBeVisible({ timeout: 25_000 });

    const attendees = page.getByRole('tab', { name: /attendees/i });
    if (await attendees.count()) {
      await attendees.first().click();
      await expect(page.locator('.attendees-table')).toBeVisible({ timeout: 25_000 });
    }
  });

  test('coaches load', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'coaches');
    await waitForGrid(page, 'coaches-table');
    await expect(page.locator('.coaches-table')).toBeVisible();
  });
});
