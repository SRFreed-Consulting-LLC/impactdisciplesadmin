import { test, expect } from '@playwright/test';
import { FIXTURES, gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Email History - the read-only log of what was actually sent.
//
// Restructured 2026-08-21: Sent Emails lost its nav leaf and became a
// button projected into the Campaigns grid header (dataGridHeaderExtra
// rather than a second headerActions entry, which would have collapsed
// BOTH actions into a kebab and buried New Campaign). It is purely
// historical now - no editing.
//
// So the first thing to prove is that it is still REACHABLE at all: a
// screen with no nav entry, reached only from another screen's header
// button, is one refactor away from being orphaned with nothing noticing.
test.describe('[email-history] Email History', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await gotoTab(page, 'campaigns-manager', 'campaigns');
    await waitForGrid(page, 'campaigns-table');
  });

  test('it is reachable from the Campaigns grid header, and only from there', async ({ page }) => {
    // No nav leaf of its own any more.
    await expect(page.getByText('Sent Emails', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await expect(page.locator('app-sent-emails')).toBeVisible({ timeout: 20_000 });
  });

  test('it lists the sent history with engagement stats', async ({ page }) => {
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    const rows = await waitForGrid(page, 'sent-emails-table');
    expect(rows).toBeGreaterThan(0);
    await expect(page.locator('.sent-emails-table')).toContainText(FIXTURES.pastTouchLabel);
  });

  test('it lists ONLY emails that were actually sent, never drafts', {
    annotation: [
      { type: 'kind', description: 'drafts-in-sent-log' },
      {
        type: 'explanation',
        description:
          'Unsent DRAFTS appear in the Sent Emails history, dated blank. ' +
          'Sent Emails lists campaign_emails ordered by sentAt and relies on ' +
          'Firestore excluding docs that have no sentAt field - its own comment ' +
          'states that assumption. The campaign email editor added 2026-08-21 ' +
          'writes `sentAt: this.touch?.sentAt ?? null` on every save ' +
          '(campaign-email-editor.component.ts:356), and an explicit null is a ' +
          'PRESENT field, so orderBy returns it. Every draft an author saves now ' +
          'shows up in a screen that is meant to be a read-only record of what ' +
          'actually went out.',
      },
      {
        type: 'fix',
        description:
          'Preferred: give Sent Emails an explicit filter (on status, or drop ' +
          'rows with no real sentAt) instead of depending on a field being ' +
          'absent - that implicit invariant is what broke, and nothing held it. ' +
          'One-line alternative: omit the sentAt key entirely for unsent drafts ' +
          'in the editor - but note this repo\'s convention is that models use ' +
          'null for "unset" (strip-undefined.ts), so that reinstates the same ' +
          'fragile assumption for the next author to trip over.',
      },
    ],
  }, async ({ page }) => {
    // The screen's own contract: "Newest first. Plain orderBy sentAt - docs
    // missing sentAt (future drafts) are excluded by Firestore's orderBy
    // semantics" (sent-emails.component.ts). That exclusion only holds while
    // a draft has NO sentAt key at all - an explicit null is a present
    // field, and orderBy returns it.
    //
    // The campaign email editor added 2026-08-21 writes
    // `sentAt: this.touch?.sentAt ?? null` on every save
    // (campaign-email-editor.component.ts:356), so every draft authored in
    // it lands in this "purely historical" log with an empty Sent date.
    // Drafts are created by 03-campaign-email.spec.ts, which runs first.
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await waitForGrid(page, 'sent-emails-table');

    const table = page.locator('.sent-emails-table');
    await expect(table).not.toContainText('E2E label');
    await expect(table).not.toContainText('Reopen ');
  });

  test('a sent email previews its real body in a sandboxed frame', async ({ page }) => {
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await waitForGrid(page, 'sent-emails-table');

    await page.locator('.sent-emails-table tbody tr').first()
      .locator('button:has(mat-icon:text("visibility"))').click();

    await expect.poll(
      () => page.locator('app-sent-email-preview-dialog iframe')
        .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerHTML?.length ?? 0),
      { timeout: 15_000 },
    ).toBeGreaterThan(10);
  });

  test('previewing does not double as a row click', async ({ page }) => {
    // The grid's row action buttons stopPropagation for exactly this
    // reason - a preview that also navigates makes the log unusable.
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await waitForGrid(page, 'sent-emails-table');

    await page.locator('.sent-emails-table tbody tr').first()
      .locator('button:has(mat-icon:text("visibility"))').click();
    await expect(page.locator('app-sent-email-preview-dialog')).toBeVisible();
    await expect(page.locator('.sent-emails-table')).toBeVisible();
  });

  test('clicking a row lands on that email\'s campaign', async ({ page }) => {
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await waitForGrid(page, 'sent-emails-table');

    await page.locator('.sent-emails-table tbody tr').first().locator('td').first().click();
    await expect(page.locator('app-campaign-detail')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.detail-header__name')).toHaveText(FIXTURES.pastCampaignName);
  });

  test('the history offers no way to edit a sent email', async ({ page }) => {
    // It became read-only on purpose. An edit affordance reappearing here
    // means someone wired the new editor to sent history by mistake.
    await page.getByRole('button', { name: 'Sent Emails' }).click();
    await waitForGrid(page, 'sent-emails-table');
    await expect(page.locator('.sent-emails-table button:has(mat-icon:text("edit"))')).toHaveCount(0);
  });
});
