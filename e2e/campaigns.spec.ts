import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// Campaign Manager v2, Phase 1: the campaigns list (all campaigns incl.
// the regrouped Mailchimp history), the campaign DETAIL view (funnel +
// touches timeline), and the Status Board lenses over the same docs.
test.describe('Campaign Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/campaigns-manager?tab=campaigns');
    await page.locator('.campaigns-table').waitFor();
  });

  test('list shows the regrouped history with kind chips and funnel stats', async ({ page }) => {
    // 78 campaigns post-regroup; the first page holds 50.
    await expect
      .poll(() => page.locator('.campaigns-table tbody tr:not(:has(.empty-state))').count(), { timeout: 15000 })
      .toBe(50);
    // Kind chips render (the big series are OTHER-kind labels).
    await expect(page.locator('.campaigns-table .chip').first()).toBeVisible();
  });

  // Split in two on 2026-08-26. As one test this opened the FIRST row and
  // asserted both "the detail renders" and "it has a touches timeline" -
  // which tied a navigation check to whichever campaign happened to sort
  // first. The list is startDate desc, so the moment a future-dated draft
  // was created ("2027 Summit Early Bird Special", starting 2026-08-28) it
  // took row 1, and a draft correctly has no emails yet: 49 of the 50 rows
  // on page one have touches, and the test opened the one that doesn't.
  // Navigation is data-independent and stays on row 1; the timeline check
  // now names a campaign instead of hoping for one.
  test('row opens the campaign detail with funnel stats', async ({ page }) => {
    const firstRow = page.locator('.campaigns-table tbody tr').first();
    await firstRow.waitFor();
    await firstRow.dblclick();

    await expect(page.locator('app-campaign-detail')).toBeVisible();
    // Funnel tiles: at least Sent / Opened / Clicked render with numbers.
    // True of any campaign, a zero-touch draft included.
    expect(await page.locator('.funnel__tile').count()).toBeGreaterThanOrEqual(5);

    // Back returns to the list and clears the deep-link param.
    await page.locator('app-campaign-detail button:has(mat-icon:text("arrow_back"))').click();
    await expect(page.locator('.campaigns-table')).toBeVisible();
  });

  test('a populated campaign lists its touches and previews a sent email', async ({ page }) => {
    // Addressed by id, not by position: this is one of the regrouped
    // ongoing series (43 emails), so it always has a timeline - whereas the
    // row it occupies moves as campaigns are added, and it is not even on
    // page one of the 50-row list at every point in its life.
    await page.goto('/campaigns-manager?tab=campaigns&campaignId=grp_disciple-making-minute');
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 15000 });

    // Touches load from campaign_emails (composite index campaignId+sentAt).
    await expect
      .poll(() => page.locator('.touch').count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    // A touch previews the real sent email in the sandboxed frame.
    await page.locator('.touch').first().locator('button:has(mat-icon:text("visibility"))').click();
    const frameLen = () =>
      page
        .locator('app-sent-email-preview-dialog iframe')
        .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerHTML?.length ?? 0);
    // Threshold is deliberately low - the newest touch may be a small
    // hand-authored test email, not a full Mailchimp-rendered document.
    await expect.poll(frameLen, { timeout: 10000 }).toBeGreaterThan(50);
    await page.locator('app-sent-email-preview-dialog button:has(mat-icon:text("close"))').click();
  });

  test('detail deep link via ?campaignId= works on a cold load', async ({ page }) => {
    await page.goto('/campaigns-manager?tab=campaigns&campaignId=grp_prayer-letter');
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.detail-header__name')).toHaveText('Prayer Letter');
  });

  test('wizard opens for a new campaign and cancels cleanly', async ({ page }) => {
    // No send here - the live send path is verified manually (a real email
    // goes out); e2e only proves the authoring surfaces mount.
    await page.getByRole('button', { name: 'New Campaign' }).click();
    await expect(page.locator('app-campaign-wizard')).toBeVisible();
    await expect(page.locator('input[formcontrolname="name"]')).toBeVisible();
    await expect(page.locator('mat-select[formcontrolname="audienceMode"]')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.campaigns-table')).toBeVisible();
  });

  test('status board renders board and calendar lenses', async ({ page }) => {
    await page.goto('/campaigns-manager?tab=status-board');
    // All history is ended - the Ended column caps at 2 cards + a view-all link.
    await expect(page.locator('.kanban')).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.locator('.kcard').count())
      .toBeGreaterThanOrEqual(1);

    await page.locator('mat-button-toggle[value="calendar"]').click();
    await expect(page.locator('.calendar')).toBeVisible();
  });
});
