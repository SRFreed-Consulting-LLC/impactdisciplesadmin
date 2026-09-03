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
  // Testimonials and Team Page left this group on 2026-08-30 for the new
  // DATA manager - they are lists of RECORDS the site renders, not a page's
  // own words. The group id is the route, so their entries carry it: see the
  // `screens` shape's third element.
  const screens: Array<[string, string, string, string]> = [
    // DMM followed them to DATA on 2026-08-31 (nav-config.ts) - a list of
    // records, not a page's own words. This entry still said 'page-manager'
    // until 2026-09-03.
    ['Disciple Making Minute', 'data', 'disciple-making-minute', 'dmms-table'],
    ['Testimonials', 'data', 'testimonials', 'testimonials-table'],
    ['Team Page', 'data', 'team-page', 'team-page-table'],
  ];

  for (const [label, group, slug, tableClass] of screens) {
    test(`${label} loads its editor grid`, async ({ page }) => {
      await gotoTab(page, group, slug);
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

    // DOUBLE-CLICK THE ROW. It was an edit button until the row itself
    // became the control (page-stack.component.html says so out loud). The
    // only `.ps__icon-btn` left on a row is `--danger`: "Delete this section
    // for good". This spec was still clicking `.ps__icon-btn` and then
    // waiting for an editor that could never open - it was pressing DELETE
    // on every run, and only the emulator's wipe-first reseed hid it.
    await stack.locator('.ps__section', { hasText: 'Overview' }).first()
      .dblclick();

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

  // Web Config and the Docking Bar moved to DATA on 2026-08-31: they are
  // site furniture, not any one page's content.
  test('Web Config loads', async ({ page }) => {
    await gotoTab(page, 'data', 'web-config');
    await expect(page.locator('app-web-config')).toBeVisible({ timeout: 30_000 });
  });

  // The docking bar had its own screen until 2026-08-29. It is site
  // furniture - the web app mounts it in app.component.html and it renders on
  // every page - so it moved onto Web Config rather than onto Home. Pinned
  // because "the editor still exists, just somewhere else" is exactly the
  // move that goes missing silently.
  test('the Docking Bar editor is reachable, under Footer', async ({ page }) => {
    // It moved AGAIN on 2026-09-01, out of Web Config and into the FOOTER
    // group as a leaf of its own - site furniture, not a settings form (see
    // nav-config.ts). It is no longer a tab, so there is nothing to click:
    // the leaf IS the screen. This spec still looked for a "Docking Bar" tab
    // on Web Config until 2026-09-03, which is exactly the silent move it
    // was written to catch - it just caught the second one, not the first.
    await gotoTab(page, 'footer', 'docking-bar');
    await expect(page.locator('app-docking-bar')).toBeVisible({ timeout: 30_000 });
  });

  // HOME LOST ITS OWN SCREEN on 2026-08-31. It was a bespoke component
  // (app-page-home, .home__section) that framed the slider and carried a
  // note saying the docking bar had moved to Web Config. It is an ordinary
  // kit page now - page_content/home, drawn by the same app-page-stack as
  // the other twelve - and that component is deleted. These two specs still
  // asserted the old screen until 2026-09-03; what is worth pinning is that
  // Home is genuinely ordinary, and that its slider is still editable.
  test('Home is an ordinary kit page, drawn by the same stack', async ({ page }) => {
    await gotoTab(page, 'page-manager', 'home');
    const stack = page.locator('app-page-stack');
    await expect(stack).toBeVisible({ timeout: 30_000 });
    await expect(stack.locator('.ps__section').first()).toBeVisible({ timeout: 30_000 });
    // Same two guards the other pages get: read nothing, or could not read.
    await expect(stack.locator('.ps__empty')).toHaveCount(0);
    await expect(stack.locator('.ps__failed')).toHaveCount(0);
    // And no section this build cannot name - Home carries the only `slides`
    // list on the site, so it is the page most likely to drift out of the
    // catalogue unnoticed.
    await expect(stack.locator('.ps__type-icon--unknown')).toHaveCount(0);
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
    const stack = page.locator('app-page-stack');
    await expect(stack.locator('.ps__section').first()).toBeVisible({ timeout: 30_000 });

    // A stack row is labelled by its KIND ('List'), not its variant, and its
    // summary counts entries - so there is no "slides" anywhere in the DOM
    // to match on. Home's first List is the slider; the entry count is
    // asserted with it so that a Home whose shape changed fails here loudly
    // rather than quietly opening whichever list came first.
    const sliderRow = stack.locator('.ps__section', { hasText: 'List' }).first();
    await expect(sliderRow).toBeVisible({ timeout: 30_000 });
    // "8 tiles", not "8 slides": the entry noun is set on the List MEMBER,
    // so every variant of it counts in tiles whatever it actually draws as.
    await expect(sliderRow).toContainText('8 tiles');
    await sliderRow.dblclick();

    await expect(page.locator('.ps--editing')).toBeVisible({ timeout: 30_000 });
    // The slides themselves, still there and still editable - which is the
    // one thing the retired `images-table` assertion was actually worth.
    await expect(page.locator('.psd__entry').first()).toBeVisible({ timeout: 30_000 });
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
    for (const [, group, slug, tableClass] of screens) {
      await gotoTab(page, group, slug);
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
