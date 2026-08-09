import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/auth';

test.describe('Left nav - collapsible manager groups', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('expanding a group reveals its sub-items, and multiple groups can stay open', async ({ page }) => {
    await page.goto('/home');

    // Collapsed by default on a route with no active manager - Purchases
    // shouldn't be visible until Store Manager is expanded.
    await expect(page.getByRole('link', { name: 'Purchases' })).toHaveCount(0);

    await page.getByRole('button', { name: 'STORE MANAGER' }).click();
    await expect(page.getByRole('link', { name: 'Purchases' })).toBeVisible();

    // Opening a second group shouldn't close the first (no accordion-
    // exclusive behavior - see MainScreenComponent.expanded).
    await page.getByRole('button', { name: 'ADMIN MANAGER' }).click();
    await expect(page.getByRole('link', { name: 'Customers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Purchases' })).toBeVisible();

    // Collapsing Store Manager again hides just its own sub-items.
    await page.getByRole('button', { name: 'STORE MANAGER' }).click();
    await expect(page.getByRole('link', { name: 'Purchases' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Customers' })).toBeVisible();
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
    await page.getByRole('button', { name: 'STORE MANAGER' }).click();
    await page.getByRole('link', { name: 'Coupons' }).click();
    await expect(page.locator('app-coupons')).toBeVisible();

    // This is the real regression risk this session's query-param handling
    // fixed: clicking a sibling tab while already on this route is a
    // same-route, query-param-only navigation - a one-time snapshot read
    // (what this code used to do) would go stale here and never switch.
    await page.getByRole('link', { name: 'Sales' }).click();
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
    await expect(page.locator('.user-menu__email')).toHaveText('shane.freed@gmail.com');
    await expect(page.locator('.user-menu__role')).not.toHaveText('');

    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});

test.describe('Settings - Themes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
  });

  test('dark mode toggle repaints the whole app', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark-theme/);

    await page.getByRole('switch', { name: 'Toggle dark mode' }).click();
    await expect(html).toHaveClass(/dark-theme/);

    // Reset so this test doesn't leave dark mode on for whichever test
    // (or human) runs against this Firestore project next.
    await page.getByRole('switch', { name: 'Toggle dark mode' }).click();
    await expect(html).not.toHaveClass(/dark-theme/);
  });

  test('picking an accent applies its theme class', async ({ page }) => {
    const html = page.locator('html');

    await page.getByRole('button', { name: 'Forest' }).click();
    await expect(html).toHaveClass(/theme-forest/);

    // Reset back to Default so no test data/preference lingers.
    await page.getByRole('button', { name: 'Default' }).click();
    await expect(html).not.toHaveClass(/theme-forest/);
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

    await page.getByRole('button', { name: 'Forest' }).click();
    await expect(html).toHaveClass(/theme-forest/);

    await page.getByRole('link', { name: 'HOME' }).click();
    await expect(html).toHaveClass(/theme-forest/);

    await page.getByRole('button', { name: 'STORE MANAGER' }).click();
    await page.getByRole('link', { name: 'Purchases' }).click();
    await expect(html).toHaveClass(/theme-forest/);

    // Reset back to Default so no test data/preference lingers.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Default' }).click();
    await expect(html).not.toHaveClass(/theme-forest/);
  });
});
