import { Page } from '@playwright/test';

// Matches the credentials saved in this project's Claude memory
// (admin-login-credentials.md) - a real login for the user's own local dev
// Firebase project, used only against `npm run start-local`.
const ADMIN_EMAIL = 'shane.freed@gmail.com';
const ADMIN_PASSWORD = 'password';

// The app's login flow is a single email+password form
// (src/app/common/forms/admin/login), backed by
// AdminAuthService/AuthGuardService - a fresh Playwright context has no
// session, so AuthGuardService should always redirect '/' to '/login' here.
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/');

  const isLoggedOut = await page
    .waitForURL(/\/login/, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!isLoggedOut) {
    return;
  }

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Successful login lands back on the dashboard shell (MainScreenComponent
  // at '/' or '/home') - wait for the login route to clear rather than for
  // one specific landing URL.
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 20000 });
}
