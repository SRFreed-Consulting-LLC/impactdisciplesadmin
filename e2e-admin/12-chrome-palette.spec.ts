import { expect, test } from '@playwright/test';
import { ADMIN_URL, loginAsAdmin } from './support/harness';

// The email designer's HEADERS & FOOTERS palette (2026-08-27).
//
// Unit tests cover handleRowDrop's chrome branch and the palette's
// index alignment, but neither can prove the thing this feature actually
// promises: that an admin can DRAG a masthead onto an email that already
// exists. cdkDropList only connects lists that are wired to each other, the
// preview iframes sit under the cursor during the drag, and both of those
// fail in a browser rather than in a unit test.
//
// Read-only against the seeded world: it builds a NEW design in the
// designer and never saves, so nothing here needs a reseed.

/**
 * Drags one element onto another the way CDK needs it.
 *
 * A single mouse.move does not start a cdkDrag - the CDK starts a drag on
 * the first move past a threshold and then tracks subsequent moves, so the
 * pointer has to travel in steps with the button held.
 */
async function dragOnto(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator
): Promise<void> {
  // The chrome group sits at the BOTTOM of the Add panel, below the fold at
  // this viewport - and a mouse.move to a point outside the viewport lands on
  // nothing, so the drag silently never starts. Scroll first, measure after.
  // (Diagnosed with document.elementFromPoint returning null at the grab
  // point while the tile's own boundingBox read y=964 in a 720px viewport.)
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();

  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error('drag source or target is not laid out');
  }
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Nudge past the CDK drag threshold before the long travel.
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 25 });
  await page.mouse.move(end.x, end.y + 2, { steps: 5 });
  await page.mouse.up();
}

// The `[chrome-palette]` prefix is load-bearing: the dashboard reporter reads
// the area id back out of this title (support/areas.ts areaOf). Without it
// areaOf returns undefined and every test in this file is dropped from the
// dashboard silently - the run reported 77 passed while the board published
// 72, which is how this was noticed.
test.describe('[chrome-palette] Email Chrome Palette', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    // A brand-new design opens the template picker over the canvas; Cancel
    // leaves the blank default, which is the empty-header case this feature
    // exists for.
    await page.goto(`${ADMIN_URL}/tools-manager/email-designer/new`);
    // "Start Blank" is the picker's cancel - it keeps the blank default,
    // which is the empty-header case this feature exists for.
    await page.getByRole('button', { name: 'Start Blank' }).click({ timeout: 30_000 });
    await expect(page.locator('app-design-canvas')).toBeVisible({ timeout: 30_000 });
  });

  test('offers both families of header and footer pieces', async ({ page }) => {
    await expect(page.getByText('HEADERS & FOOTERS')).toBeVisible();
    await expect(page.getByText('RECEIPTS & CONFIRMATIONS')).toBeVisible();
    await expect(page.getByText('NEWSLETTER', { exact: true })).toBeVisible();
    // 12 pieces: 5 shells split into header+footer, plus 2 transactional.
    await expect(page.locator('.chrome-tile')).toHaveCount(12);
  });

  test('renders a live preview for every piece', async ({ page }) => {
    const frames = page.locator('.chrome-tile .chrome-thumb iframe');
    await expect(frames).toHaveCount(12);
    // srcdoc, not src: the preview is compiled html, not a fetch.
    for (const frame of await frames.all()) {
      expect(await frame.getAttribute('srcdoc')).toBeTruthy();
    }
  });

  test('drags a transactional masthead into the HEADER section', async ({ page }) => {
    const headerSection = page.locator('app-design-canvas .section-rows').first();
    const masthead = page.locator('.chrome-tile', { hasText: 'Logo masthead' }).first();

    await expect(headerSection.locator('app-block-host')).toHaveCount(0);

    await dragOnto(page, masthead, headerSection);

    // The logo block landed, in the header, as a real block on the canvas.
    await expect(headerSection.locator('app-block-host')).toHaveCount(1, { timeout: 15_000 });
    await expect(headerSection.locator('img')).toBeVisible();
  });

  test('the drop is ONE undo step', async ({ page }) => {
    const headerSection = page.locator('app-design-canvas .section-rows').first();
    const masthead = page.locator('.chrome-tile', { hasText: 'Logo masthead' }).first();

    await dragOnto(page, masthead, headerSection);
    await expect(headerSection.locator('app-block-host')).toHaveCount(1, { timeout: 15_000 });

    await page.keyboard.press('Control+z');

    await expect(headerSection.locator('app-block-host')).toHaveCount(0, { timeout: 15_000 });
  });

  test('a dropped newsletter footer is clean of dead Mailchimp tags', async ({ page }) => {
    // A mined footer used to carry six Mailchimp system tags that nothing
    // here resolves - they would have printed raw in a customer's inbox.
    const footerSection = page.locator('app-design-canvas .section-rows').last();
    const footer = page.locator('.chrome-tile', { hasText: 'Newsletter 1 footer' }).first();

    await dragOnto(page, footer, footerSection);
    await expect(footerSection.locator('app-block-host')).toHaveCount(1, { timeout: 15_000 });

    const text = (await footerSection.innerText()) ?? '';
    for (const dead of ['LIST:COMPANY', 'LIST_ADDRESS_HTML', 'IFNOT:ARCHIVE_PAGE',
      'END:IF', 'UPDATE_PROFILE', 'UNSUB', 'BRAND_ADDRESS']) {
      expect(text, `${dead} must not survive`).not.toContain(dead);
    }

    // The address was substituted AT DROP TIME out of the config document -
    // this is the emulator's seeded address, proving the seed actually
    // reached the row rather than a placeholder being dropped silently.
    expect(text).toContain('Impact Discipleship Ministries');
    expect(text).toContain('Atlanta');

    // *|CURRENT_YEAR|* is EXPECTED to still be here. The canvas renders a
    // template being edited, where merge tags are deliberately unrendered
    // (exactly as *|FNAME|* is); it resolves at send, which merge-tags.spec
    // covers on both renderers.
    expect(text).toContain('*|CURRENT_YEAR|*');
  });
});
