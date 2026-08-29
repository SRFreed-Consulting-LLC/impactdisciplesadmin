import { test, expect } from '@playwright/test';
import { collectConsoleErrors, gotoTab, loginAsAdmin, waitForGrid } from './support/harness';

// AREA: Website Content - everything the PUBLIC site renders out of
// Firestore. If an editor here breaks, the public site does not go down; it
// quietly stops being updatable, which is worse because nothing alerts.
//
// Each of these is one screen with one grid, so this file is deliberately
// broad and shallow: it proves every content editor still mounts and loads.
// That is exactly the class of breakage a shared-component refactor causes
// (five screens were moved onto BaseListComponent in the last sweep), and
// it is invisible to every other test layer.
test.describe('[content] Website Content', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // Content Manager became PAGE MANAGER on 2026-08-29, and 'Home Page
  // Images' became the slider SECTION of a new 'Home' screen. The group id
  // is the route, so these slugs move with it - see nav-config.ts.
  // Screens that still ARE a grid. Home is not one of them any more: its
  // slider became a row of a section stack on 2026-08-29 and its slides moved
  // into a dialog, which is what the two tests further down cover.
  const screens: Array<[string, string, string]> = [
    ['Disciple Making Minute', 'disciple-making-minute', 'dmms-table'],
    ['Testimonials', 'testimonials', 'testimonials-table'],
    ['Team Page', 'team-page', 'team-page-table'],
  ];

  for (const [label, slug, tableClass] of screens) {
    test(`${label} loads its editor grid`, async ({ page }) => {
      await gotoTab(page, 'page-manager', slug);
      await waitForGrid(page, tableClass);
      await expect(page.locator(`.${tableClass}`)).toBeVisible();
    });
  }

  // EVERY PUBLIC PAGE, added 2026-08-29 when the last ten moved off the slot
  // editor onto the same ordered section stack About Us had. One screen serves
  // all eleven, driven by page-section-catalogue.ts - so the thing worth
  // pinning is not that the screen mounts (it is the same component every
  // time) but that each page's DOCUMENT still matches the catalogue: a
  // section whose type the page no longer offers renders as "Unknown section"
  // here and as nothing at all on the site.
  const publicPages: Array<[string, string]> = [
    ['About Us', 'about-us'],
    ['Equipping Groups', 'equipping-groups'],
    ['Equipping - Pastors', 'equipping-groups-pastors'],
    ['Equipping - Leaders', 'equipping-groups-leaders'],
    ['Equipping - Churches', 'equipping-groups-churches'],
    ['Seminars', 'seminars'],
    ['Lunch and Learns', 'lunch-and-learns'],
    ['Give', 'give'],
    ['Contact', 'contact'],
    ['Discipleship Library', 'discipleship-library'],
    ['Prayer Team', 'prayer-team'],
    // Joined the stack on 2026-08-29, off its own bespoke screen.
    ['Coaching with Impact', 'coaching-with-impact'],
  ];

  for (const [label, slug] of publicPages) {
    test(`${label} loads its section stack and previews every section`, async ({ page }) => {
      await gotoTab(page, 'page-manager', slug);

      const stack = page.locator('app-page-stack');
      await expect(stack).toBeVisible({ timeout: 30_000 });
      await expect(stack.locator('.ps__section').first()).toBeVisible({ timeout: 30_000 });

      // A page that read nothing shows the empty-page warning; one that could
      // not read at all shows the failure banner. Both are silent otherwise.
      await expect(stack.locator('.ps__empty')).toHaveCount(0);
      await expect(stack.locator('.ps__failed')).toHaveCount(0);

      // No stored section the admin cannot name - the way a catalogue and a
      // document drift apart. (The other half of this used to check the
      // preview could DRAW every section; the previewer frames the real page
      // now, so there is no drawing left to disagree with the data.)
      await expect(stack.locator('.ps__name', { hasText: 'Unknown section' })).toHaveCount(0);

      // The previewer points at the page it says it does. It frames the web
      // app paired with this admin - :4201 under the emulator config - and
      // getting that wrong would show a visitor a different page's preview
      // with nothing to indicate it.
      await expect(stack.locator('app-page-live-preview iframe'))
        .toHaveAttribute('src', new RegExp(`${slug}\\?adminPreview=`));
    });
  }

  test('a section opens FULL SCREEN, previews itself alone, and cancels back', async ({ page }) => {
    // It was a pop-up until 2026-08-29. The three things worth pinning are
    // that the stack gives way rather than being covered, that the rail
    // narrows to the one section being edited, and that backing out returns
    // to the list - a dead end here would strand staff in an editor.
    await gotoTab(page, 'page-manager', 'seminars');
    const stack = page.locator('app-page-stack');
    await expect(stack.locator('.ps__section').first()).toBeVisible({ timeout: 30_000 });

    await stack.locator('.ps__section', { hasText: 'Overview' }).first()
      .locator('.ps__icon-btn').first().click();

    await expect(page.locator('.ps--editing')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('app-page-section-editor')).toBeVisible();
    // The stack is GONE, not merely behind something.
    await expect(page.locator('.ps__stack')).toHaveCount(0);

    // The frame asks the site for that one section, which is what makes the
    // page drop its header, footer and every other section.
    await expect(page.locator('app-page-live-preview iframe'))
      .toHaveAttribute('src', /section=overview/);

    await page.getByRole('button', { name: 'CANCEL' }).click();

    await expect(page.locator('.ps__stack')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('app-page-section-editor')).toHaveCount(0);
  });

  test('Web Config loads', async ({ page }) => {
    await gotoTab(page, 'page-manager', 'web-config');
    await expect(page.locator('app-web-config')).toBeVisible({ timeout: 30_000 });
  });

  // The docking bar had its own screen until 2026-08-29. It is site
  // furniture - the web app mounts it in app.component.html and it renders on
  // every page - so it moved onto Web Config rather than onto Home. Pinned
  // because "the editor still exists, just somewhere else" is exactly the
  // move that goes missing silently.
  test('the Docking Bar editor is reachable, on Web Config', async ({ page }) => {
    await gotoTab(page, 'page-manager', 'web-config');
    await page.getByRole('tab', { name: 'Docking Bar' }).click();
    await expect(page.locator('app-docking-bar')).toBeVisible({ timeout: 30_000 });
  });

  test('Home frames the slider and points at where the docking bar went', async ({ page }) => {
    await gotoTab(page, 'page-manager', 'home');
    await expect(page.locator('app-page-home')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.home__section').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('app-page-home')).toContainText('Web Config');
  });

  test('the Home slider opens its slides full screen', async ({ page }) => {
    // The slides table stopped being visible on the Home screen itself on
    // 2026-08-29, when the slider became one row of the section stack - first
    // into a dialog, then, later the same day, onto a full screen like every
    // other section's editor. Three tests in this file asserted it was on the
    // screen and had been red since; opening the row is the fix rather than
    // dropping the assertion, because "the grid still loads" is the one thing
    // worth knowing about it.
    await gotoTab(page, 'page-manager', 'home');
    const sliderRow = page.locator('.home__section', { hasText: 'Slider' }).first();
    await expect(sliderRow).toBeVisible({ timeout: 30_000 });

    await sliderRow.locator('.home__icon-btn').first().click();

    await waitForGrid(page, 'images-table');
    await expect(page.locator('.images-table')).toBeVisible();
  });

  test('the old content-manager route still resolves', async ({ page }) => {
    // Pre-rename bookmarks and any stale deep link.
    await page.goto('/content-manager?tab=web-config');
    await expect(page).toHaveURL(/page-manager/, { timeout: 30_000 });
  });

  test('the shared list screens run without throwing', async ({ page }) => {
    // These moved onto BaseListComponent together; a break in the base class
    // shows up as a thrown error rather than a missing element.
    const errors = collectConsoleErrors(page);
    for (const [, slug, tableClass] of screens) {
      await gotoTab(page, 'page-manager', slug);
      await waitForGrid(page, tableClass);
    }
    expect(errors, `browser threw:\n${errors.join('\n')}`).toEqual([]);
  });

  test('every public page opens its editor without throwing', async ({ page }) => {
    // One component draws all eleven stacks, so a break in it is eleven
    // screens at once - and it surfaces as a thrown error rather than a
    // missing element, which is exactly what the per-page tests above would
    // miss.
    const errors = collectConsoleErrors(page);
    for (const [, slug] of publicPages) {
      await gotoTab(page, 'page-manager', slug);
      await expect(page.locator('app-page-stack .ps__section').first())
        .toBeVisible({ timeout: 30_000 });
    }
    expect(errors, `browser threw:\n${errors.join('\n')}`).toEqual([]);
  });
});
