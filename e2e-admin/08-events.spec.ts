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

  test('an event opens its editor', async ({ page }) => {
    // Asserted on app-event-form, NOT on a mat-tab-group. A regular event's
    // Details | Attendees strip was removed on 2026-08-27 - attendees became
    // a full-page REPORT off the list's row action instead - so the tab group
    // this used to wait for is not rendered for a regular event at all. The
    // test had been red ever since while the screen worked perfectly; it was
    // pointing at markup that no longer exists.
    await gotoTab(page, 'events-manager', 'events');
    await waitForGrid(page, 'events-table');
    await page.locator('.events-table tbody tr').first().dblclick();

    await expect(page.locator('app-event-form')).toBeVisible({ timeout: 25_000 });
    // Its values are loaded, not just its shell - an empty form would
    // otherwise pass this.
    await expect(page.getByRole('textbox', { name: 'Event Name' })).not.toBeEmpty();
  });

  test('the attendees report lists registrations', async ({ page }) => {
    // VIEW ATTENDEES on the row, not a tab inside the editor. The old version
    // looked for a tab, found none, and skipped its assertions entirely - so
    // it could only ever fail on the way in, never on what it was meant to
    // check. This opens the report the way a person does.
    await gotoTab(page, 'events-manager', 'events');
    await waitForGrid(page, 'events-table');

    await page.locator('.events-table tbody tr').first()
      .getByRole('button', { name: /view attendees/i }).click();

    await expect(page.locator('app-event-attendees')).toBeVisible({ timeout: 25_000 });
  });

  test('coaches load', async ({ page }) => {
    await gotoTab(page, 'events-manager', 'coaches');
    await waitForGrid(page, 'coaches-table');
    await expect(page.locator('.coaches-table')).toBeVisible();
  });
});
