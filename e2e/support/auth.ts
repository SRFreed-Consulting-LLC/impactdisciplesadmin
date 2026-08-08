import { Page } from '@playwright/test';

// Matches the credentials saved in this project's Claude memory
// (admin-login-credentials.md) - a real login for the user's own local dev
// Firebase project, used only against `npm run start-local`.
const ADMIN_EMAIL = 'shane.freed@gmail.com';
const ADMIN_PASSWORD = 'password';

// The app's login flow is two screens (AdminAuthService / AuthGuardService,
// see impactdisciplescommon/src/forms/admin): enter an email on
// capture-username-form, get routed to capture-password-form, enter a
// password there. Both screens still run their own dx-form internally (out
// of scope for this migration), so this targets the underlying
// input[type=email]/input[type=password] elements directly rather than any
// DevExtreme-generated wrapper markup, and drives the submit via Enter
// (both screens' dx-form submit button has useSubmitBehavior: true, so
// Enter in the field triggers the same native form submit Angular's
// (submit) handler listens for).
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/');

  // A fresh Playwright context has no session, so AuthGuardService should
  // always redirect to the login flow here - if it doesn't (e.g. a future
  // storageState-reuse setup), there's nothing left to do.
  const isLoggedOut = await page
    .waitForURL(/capture-username-form/, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!isLoggedOut) {
    return;
  }

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible' });
  await emailInput.fill(ADMIN_EMAIL);
  await emailInput.press('Enter');

  await page.waitForURL(/capture-password-form/, { timeout: 15000 });

  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible' });
  await passwordInput.fill(ADMIN_PASSWORD);
  await passwordInput.press('Enter');

  // Successful login lands back on the dashboard shell (MainScreenComponent
  // at '/' or '/home') - wait for the login routes to clear rather than for
  // one specific landing URL.
  await page.waitForURL((url) => !/capture-(username|password)-form/.test(url.pathname), { timeout: 20000 });
}
