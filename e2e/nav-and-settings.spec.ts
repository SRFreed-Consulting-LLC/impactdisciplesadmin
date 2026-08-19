import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

test.describe('Left nav - collapsible manager groups', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // Group buttons' accessible names are the SHORT navy-redesign labels
  // ("CONTACTS", "STORE" - what the drawer actually renders), not
  // nav-config's internal "CONTACTS MANAGER" strings the pre-redesign
  // version of this spec targeted (fixed 2026-08-18, same staleness batch
  // as the Settings-Themes rewrite below).
  test('expanding a group reveals its sub-items, and multiple groups can stay open', async ({ page }) => {
    await page.goto('/home');

    // Collapsed by default on a route with no active manager - Purchases
    // shouldn't be visible until Contacts is expanded (Purchases moved
    // from Store Manager to Contacts Manager (nee Customers Manager) in nav-config.ts's 2026-08
    // reorg - see that file's header comment).
    await expect(page.getByText('Purchases', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'CONTACTS', exact: true }).click();
    await expect(page.getByText('Purchases', { exact: true })).toBeVisible();

    // Opening a second group shouldn't close the first (no accordion-
    // exclusive behavior - see MainScreenComponent.expanded). Store has no
    // label overlap with Contacts' items, unlike Reports (which also has
    // its own separate "Purchases" entry) - picked deliberately to avoid a
    // two-match ambiguity here.
    await page.getByRole('button', { name: 'STORE', exact: true }).click();
    await expect(page.getByText('Products', { exact: true })).toBeVisible();
    await expect(page.getByText('Purchases', { exact: true })).toBeVisible();

    // Collapsing Contacts again hides just its own sub-items.
    await page.getByRole('button', { name: 'CONTACTS', exact: true }).click();
    await expect(page.getByText('Purchases', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Products', { exact: true })).toBeVisible();
  });

  test('clicking between sibling tabs switches content live', async ({ page }) => {
    // Enter via a hard reload to a *light* route first (Home - no manager
    // content of its own, see the other test in this file for why: Store
    // Manager's default tab (Products) mounts 5 of its own streamAll()
    // calls immediately on construction, adding to an already-heavy
    // cold-load Firestore burst that FirebaseDAO's documented WebChannel-
    // race retry doesn't fully absorb - a real, separately-tracked
    // reliability gap, not something this test needs to also stress).
    await page.goto('/home');
    await page.getByRole('button', { name: 'STORE', exact: true }).click();
    await page.getByText('Coupons', { exact: true }).click();
    await expect(page.locator('app-coupons')).toBeVisible();

    // This is the real regression risk this session's query-param handling
    // fixed: clicking a sibling tab while already on this route is a
    // same-route, query-param-only navigation - a one-time snapshot read
    // (what this code used to do) would go stale here and never switch.
    await page.getByText('Sales', { exact: true }).click();
    await expect(page.locator('app-sales')).toBeVisible();
  });
});

test.describe('User menu', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('shows identity and links to Settings', async ({ page }) => {
    await page.goto('/home');

    await page.locator('.impact-header__user').click();
    // Longer timeout than the 5s default - currentUser comes from
    // AdminAuthService.dao.loggedInUser$, a one-time Firestore read (same
    // class of cold-load race as FireAuthDao's own loggedInUser$, see the
    // Settings-Themes describe block below) that can occasionally take a
    // few seconds after a fresh login before this menu's fields populate.
    await expect(page.locator('.user-menu__email')).toHaveText('shane.freed@gmail.com', { timeout: 15000 });
    await expect(page.locator('.user-menu__role')).not.toHaveText('');

    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});

// Rewritten 2026-08-18 for the navy redesign's theme system: the old
// independent dark-mode toggle is GONE on purpose (each of the 10 navy
// variants fixes its own light/dark character - see ThemeService's own
// comment), and the pre-navy ids ('default'/'forest'/...) were replaced by
// the COLOR_THEMES set ('slate-elevate' default, 'midnight-paper', ...).
// The old spec kept clicking a switch that no longer exists.
test.describe('Settings - Themes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
  });

  test('theme picker renders every variant and marks the current one', async ({ page }) => {
    const options = page.locator('.accent-option');
    // All 10 navy variants (COLOR_THEMES in theme.service.ts).
    await expect(options).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Slate Elevate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Midnight Paper' })).toBeVisible();
    await expect(page.locator('.accent-option--selected')).toHaveCount(1);
  });

  test('picking a theme applies its theme class', async ({ page }) => {
    const html = page.locator('html');

    await page.getByRole('button', { name: 'Midnight Paper' }).click();
    await expect(html).toHaveClass(/theme-midnight-paper/);

    // Reset back to the default so no preference lingers on this admin's
    // profile for whichever test (or human) runs next.
    await page.getByRole('button', { name: 'Slate Elevate' }).click();
    await expect(html).not.toHaveClass(/theme-midnight-paper/);
  });

  test('a chosen theme survives real navigation, not just the settings page', async ({ page }) => {
    // Regression test for a live-diagnosed bug: FireAuthDao.loggedInUser$ is
    // a one-time Firestore read cached forever via shareReplay(1) - it never
    // refetches after ThemeService's own persist() writes a change. Without
    // ThemeService's remoteSyncLocked guard, that permanently-stale cached
    // snapshot would silently overwrite a just-applied local theme change
    // the moment ANY later emission of it landed - "I switched themes and
    // saw no difference" was this: the theme was applied for a moment, then
    // immediately reverted. Uses real routerLink clicks (not page.goto(),
    // which does a hard reload) to match how an admin actually navigates.
    const html = page.locator('html');

    await page.getByRole('button', { name: 'Midnight Paper' }).click();
    await expect(html).toHaveClass(/theme-midnight-paper/);

    await page.getByText('HOME', { exact: true }).click();
    await expect(html).toHaveClass(/theme-midnight-paper/);

    await page.getByText('CONTACTS', { exact: true }).click();
    await page.getByText('Purchases', { exact: true }).click();
    await expect(html).toHaveClass(/theme-midnight-paper/);

    // Reset back to the default so no preference lingers.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Slate Elevate' }).click();
    await expect(html).not.toHaveClass(/theme-midnight-paper/);
  });
});
