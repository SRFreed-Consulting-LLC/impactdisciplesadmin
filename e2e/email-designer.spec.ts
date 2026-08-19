import { test, expect, Page, Locator } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

// The Mailchimp-style email builder (Tools Manager > Email Templates >
// New Email Design; /tools-manager/email-designer/new | :id). CDK drag-drop
// needs real mouse movement past the drag threshold, hence dragTo() rather
// than Playwright's dragAndDrop() (which dispatches too few move events for
// CDK to track reliably).
async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error('dragTo: element not visible');
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

// Navigating right after login can race the app's own post-login
// router.navigate - the app's navigation wins and the goto is swallowed,
// leaving the test on the dashboard. Retry until the designer shell mounts.
async function gotoNewDesigner(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto('/tools-manager/email-designer/new');
    const mounted = await page
      .locator('.designer-shell')
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (mounted) {
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('email designer never mounted at /tools-manager/email-designer/new');
}

test.describe('Email designer', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await gotoNewDesigner(page);
    // The start-from gallery opens on /new; Start Blank keeps the default.
    await page.locator('mat-dialog-container:has-text("Start Your Email")').waitFor();
  });

  test('start-from gallery loads a starter onto the canvas', async ({ page }) => {
    await page.click('.tile:has-text("Simple newsletter")');
    await expect(page.locator('app-block-host').first()).toBeVisible();
    expect(await page.locator('app-block-host').count()).toBeGreaterThanOrEqual(5);
  });

  test('drag a layout and a text block in, edit inline, undo/redo', async ({ page }) => {
    await page.click('mat-dialog-container button:has-text("Start Blank")');

    // 1-column layout into the body section, then a Text chip into it.
    const bodyRows = page.locator('[id^="rows-"]').nth(1);
    await dragTo(page, page.locator('.layout-tile').first(), bodyRows);
    await dragTo(page, page.locator('.chip:has-text("Text")'), page.locator('[id^="col-"]').first());
    await expect(page.locator('.text-view')).toHaveCount(1);

    // Click selects, second click activates the inline Quill editor.
    await page.locator('.text-view').click();
    await page.locator('.text-view').click();
    await expect(page.locator('app-inline-text-editor .ql-editor')).toHaveCount(1);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Hello from e2e');
    await page.click('.canvas-scroll', { position: { x: 30, y: 300 } });
    await expect(page.locator('.text-view')).toContainText('Hello from e2e');

    // Undo reverts the text commit; redo restores it.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.text-view')).not.toContainText('Hello from e2e');
    await page.keyboard.press('Control+y');
    await expect(page.locator('.text-view')).toContainText('Hello from e2e');
  });

  test('preview compiles the design and substitutes sample merge data', async ({ page }) => {
    await page.click('.tile:has-text("Simple newsletter")');
    // The picker's afterClosed() fires after its close animation - wait for
    // the starter to actually land on the canvas before opening Preview,
    // or the preview compiles the still-blank default design.
    await expect(page.locator('app-block-host').first()).toBeVisible();
    await page.click('button:has-text("Preview")');

    // Read through contentDocument rather than frameLocator: a srcdoc
    // iframe under sandbox can lag/confuse frameLocator's frame attachment,
    // while allow-same-origin makes the document directly readable.
    const frameText = () =>
      page
        .locator('.preview-frame')
        .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerText ?? '');

    await expect.poll(frameText, { timeout: 10000 }).toContain('*|FNAME|*');

    await page.click('.sample-toggle');
    await expect.poll(frameText, { timeout: 10000 }).toContain('Alex');
    await expect.poll(frameText).not.toContain('*|FNAME|*');
  });

  test('mobile toggle stacks columns on the canvas', async ({ page }) => {
    await page.click('mat-dialog-container button:has-text("Start Blank")');
    const bodyRows = page.locator('[id^="rows-"]').nth(1);
    await dragTo(page, page.locator('.layout-tile').nth(1), bodyRows); // 2 columns
    await expect(page.locator('[id^="col-"]')).toHaveCount(2);

    await page.click('mat-button-toggle[value="mobile"]');
    await expect(page.locator('.columns.stacked')).toHaveCount(1);
    // .page animates its width (0.18s transition) - poll until it settles.
    await expect
      .poll(() => page.locator('.page').evaluate((el) => Math.round(el.getBoundingClientRect().width)))
      .toBe(375);
  });

  test('leaving with unsaved changes prompts, canceling stays', async ({ page }) => {
    // Loading a starter alone does NOT arm the dirty guard (state.load()
    // resets dirty) - make a real edit first.
    await page.click('mat-dialog-container button:has-text("Start Blank")');
    const bodyRows = page.locator('[id^="rows-"]').nth(1);
    await dragTo(page, page.locator('.layout-tile').first(), bodyRows);
    await dragTo(page, page.locator('.chip:has-text("Divider")'), page.locator('[id^="col-"]').first());
    await expect(page.locator('.divider-view')).toHaveCount(1);

    await page.click('mat-toolbar button:has(mat-icon:text("arrow_back"))');
    const dialog = page.locator('mat-dialog-container:has-text("Unsaved Changes")');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("Cancel")').click();
    await expect(page).toHaveURL(/email-designer\/new/);
  });

  test('legacy rich-text templates open in the designer with their content imported', async ({ page }) => {
    await page.goto('/tools-manager?tab=email-templates');
    // Every legacy row shows Rich Text in the Editor column.
    const legacyRow = page.locator('tr:has-text("Rich Text")').first();
    await legacyRow.waitFor();
    await legacyRow.dblclick();

    // Lands in the full-screen designer, the legacy html imported as a
    // text block on the canvas (NOT the old Quill dialog).
    await expect(page).toHaveURL(/\/tools-manager\/email-designer\//);
    await expect(page.locator('.designer-shell')).toBeVisible();
    const imported = page.locator('.text-view').first();
    await expect(imported).toBeVisible();
    await expect
      .poll(() => imported.evaluate((el) => (el.textContent ?? '').trim().length))
      .toBeGreaterThan(0);

    // Merely opening an imported template is NOT dirty - leaving must not
    // prompt, and nothing about the stored template changed.
    await page.click('mat-toolbar button:has(mat-icon:text("arrow_back"))');
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
    await expect(page).toHaveURL(/tab=email-templates/);
  });
});
