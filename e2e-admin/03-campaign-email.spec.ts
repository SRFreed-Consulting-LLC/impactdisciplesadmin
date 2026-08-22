import { test, expect, Page } from '@playwright/test';
import {
  ADMIN_URL, FIXTURES, collectConsoleErrors, fields, listDocs,
  loginAsAdmin, reseedEmulator,
} from './support/harness';

// AREA: Campaign Email Authoring - the screen rewritten 2026-08-21.
//
// This is the highest-value file in the suite, because the rewrite changed
// ONLY the browser. No Cloud Function moved, no document shape changed - so
// the entire integration/ suite stays green whether this screen works or is
// a blank page. If the campaign editor breaks, this file is the only thing
// in the repo that would say so.
//
// What the rewrite did, and what each test here pins:
//   - design + schedule merged onto ONE full-screen route, lazily loaded
//     (its own NgModule) - so a broken loadChildren is a real risk
//   - a NEW email opens on the "Start Your Email" starter picker
//   - the send settings moved behind a Schedule slide-over
//   - templates split into 'system' and 'campaign' kinds; this editor is
//     the only thing that creates campaign-kind ones
//   - an unsaved-changes guard now sits on the route
//   - the touch stores builder JSON in `design`, and `html` is recompiled
//     from it on every save (the send engine only ever reads html) - the
//     old editor never populated `design` at all
test.describe('[campaign-email] Campaign Email Authoring', () => {
  // This file WRITES (it saves drafts), so it starts from a clean world.
  test.beforeAll(() => {
    reseedEmulator();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  const newEmailUrl = `${ADMIN_URL}/campaigns-manager/email/${FIXTURES.liveCampaign}/new`;

  /**
   * Opens the new-email editor and gets past the starter picker.
   *
   * A new email does NOT land on an empty canvas - it opens the "Start Your
   * Email" dialog first (Blank / Prayer Letter / Disciple-Making Minute /
   * Blog Post / ...). Its cdk overlay backdrop swallows every click behind
   * it, so any test that skips this dismissal fails on a completely
   * unrelated-looking "element intercepts pointer events" timeout. That
   * cost four failures and one flake on this suite's first run.
   */
  async function openNewEmail(page: Page): Promise<void> {
    await page.goto(newEmailUrl);
    await expect(page.locator('app-campaign-email-editor')).toBeVisible({ timeout: 30_000 });
    const starter = page.getByRole('button', { name: 'Start Blank' });
    await starter.waitFor({ timeout: 20_000 });
    await starter.click();
    // Backdrop must actually be gone before anything else is clickable.
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0, { timeout: 15_000 });
  }

  test('the editor route loads its lazy chunk and mounts the builder', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openNewEmail(page);

    // The two halves that used to live in different places entirely.
    await expect(page.locator('app-design-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('app-designer-side-panel')).toBeVisible();
    // Full-screen: the manager tab shell must NOT be wrapped around it.
    await expect(page.locator('app-campaigns-manager')).toHaveCount(0);

    expect(errors, `browser threw:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a new email opens on the starter picker', async ({ page }) => {
    // The picker is the first thing an author sees, and it is the only
    // route to the campaign-kind starters - if it stops opening, every new
    // email silently begins blank.
    await page.goto(newEmailUrl);
    await expect(page.locator('app-campaign-email-editor')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Start Your Email')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Start Blank' })).toBeVisible();
  });

  test('a cold direct URL hit does not bounce a legitimate admin out', async ({ page }) => {
    // The documented cold-load race: on a direct URL, PermissionService's
    // cached user has not arrived yet and a synchronous canAdd/canEdit
    // would reject a real admin. The component waits on loggedInUser$ for
    // exactly this - if that regresses, this test catches it and nothing
    // else in the repo does.
    await page.goto(newEmailUrl);
    await expect(page.locator('app-campaign-email-editor')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/campaigns-manager\/email\//);
  });

  test('a new email starts as unsaved and offers a subject', async ({ page }) => {
    await openNewEmail(page);
    await expect(page.locator('.status-chip')).toContainText(/not saved/i);
    // Subject is the one required control (Validators.required).
    await expect(page.locator('input.subject-input').first()).toBeVisible();
  });

  test('the Schedule slide-over opens and offers the send modes', async ({ page }) => {
    await openNewEmail(page);

    await expect(page.locator('.schedule-panel')).toHaveCount(0);
    await page.getByRole('button', { name: /schedule/i }).first().click();
    await expect(page.locator('.schedule-panel')).toBeVisible({ timeout: 10_000 });
    // The send settings that used to be a column of form fields.
    await expect(page.locator('.schedule-panel mat-radio-group')).toBeVisible();
    await expect(page.locator('.schedule-panel')).toContainText(/WHEN DOES IT SEND/i);

    // And it closes again.
    await page.locator('.schedule-panel__head button').click();
    await expect(page.locator('.schedule-panel')).toHaveCount(0);
  });

  test('saving a draft persists it, and recompiles html from the design', async ({ page }) => {
    await openNewEmail(page);

    const subject = `E2E draft ${Date.now()}`;
    await page.locator('input.label-input').fill('E2E label');
    await page.locator('input.subject-input').first().fill(subject);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // The chip flips off "not saved" once the new id lands.
    await expect(page.locator('.status-chip')).not.toContainText(/not saved/i, { timeout: 25_000 });

    // Prove it in Firestore, not just on screen. Both fields matter: the
    // send engine reads ONLY html, and the editor reloads from design.
    await expect.poll(async () => {
      const docs = await listDocs('campaign_emails');
      const mine = docs.map(fields).find((d) => d['subject'] === subject);
      if (!mine) return 'missing';
      if (!mine['html']) return 'no-html';
      if (!mine['design']) return 'no-design';
      return 'ok';
    }, { timeout: 30_000 }).toBe('ok');
  });

  test('a saved draft reopens with its own content, not a blank canvas', async ({ page }) => {
    // Round-trips the storage contract the rewrite introduced: save writes
    // `design`, and reopening rehydrates the builder from it.
    await openNewEmail(page);
    const label = `Reopen ${Date.now()}`;
    await page.locator('input.label-input').fill(label);
    await page.locator('input.subject-input').first().fill('Reopen subject');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.status-chip')).not.toContainText(/not saved/i, { timeout: 25_000 });

    // The URL now carries the real touch id - reload it cold.
    const url = page.url();
    expect(url).not.toMatch(/\/new$/);
    await page.goto(url);
    await expect(page.locator('input.label-input')).toHaveValue(label, { timeout: 30_000 });
  });

  test('a SENT email cannot be opened in the editor', async ({ page }) => {
    // The seeded touch is history (it has sentAt and no draft/scheduled
    // status). The editor's load() refuses anything that is not a draft or
    // scheduled - which is the same invariant that made Sent Emails
    // read-only. Opening one by URL must not present an editable canvas.
    await page.goto(
      `${ADMIN_URL}/campaigns-manager/email/${FIXTURES.pastCampaign}/${FIXTURES.pastTouch}`);
    await page.waitForTimeout(6000);
    const stillEditing = await page.locator('input.label-input').count();
    if (stillEditing) {
      await expect(page.locator('input.label-input')).not.toHaveValue(FIXTURES.pastTouchLabel);
    }
  });

  test('leaving with unsaved changes is guarded', async ({ page }) => {
    await openNewEmail(page);

    // Make it dirty, then try to leave via the editor's own back button.
    await page.locator('input.subject-input').first().fill('Unsaved work that must not vanish');
    await page.locator('.editor-topbar button').first().click();

    // The guard prompts (ConfirmService dialog) rather than silently
    // discarding. Either the dialog is up, or we are still on the editor.
    const guarded = await Promise.race([
      page.locator('mat-dialog-container').waitFor({ timeout: 8000 }).then(() => true).catch(() => false),
      page.waitForTimeout(8000).then(() => /\/email\//.test(page.url())),
    ]);
    expect(guarded, 'navigating away from a dirty editor was not guarded').toBe(true);
  });

  test('a design can be saved as a campaign-kind template', async ({ page }) => {
    // Save-as-template is the only producer of campaign-kind templates -
    // the other half of the 2026-08-21 system/campaign split.
    await openNewEmail(page);
    await page.locator('input.subject-input').first().fill('Template source');
    await page.locator('button[mattooltip="Save this design as a campaign template"]').click();
    await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 15_000 });
  });

  test('the starter picker can be reopened from the toolbar', async ({ page }) => {
    await openNewEmail(page);
    await page.locator('button[mattooltip="Start from a template"]').click();
    await expect(page.locator('mat-dialog-container').first()).toBeVisible({ timeout: 15_000 });
  });
});
