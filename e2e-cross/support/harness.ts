import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Page, expect } from '@playwright/test';

// Shared helpers for the cross-app emulator flows. Everything here targets
// the SEEDED EMULATOR accounts (scripts/fixtures/emulator-fixtures.js) -
// never real credentials, never a real Firebase project.

export const ADMIN_URL = 'http://localhost:5200';
export const WEB_URL = 'http://localhost:4200';
export const ADMIN_EMAIL = 'admin@test.local';
export const ADMIN_PASSWORD = 'test-password-1';

/**
 * Wipe-first reseed of the emulator world (scripts/seed-emulator.js waits
 * for trigger quiescence, so this is slow - ~30-60s - but leaves an exactly
 * deterministic world). Reseeding also wipes AUTH, killing any signed-in
 * browser session: call it in beforeAll BEFORE any login, once per spec
 * file at most.
 */
export function reseedEmulator(): void {
  execFileSync(process.execPath,
    [path.join(__dirname, '..', '..', 'scripts', 'seed-emulator.js')],
    { stdio: 'pipe', timeout: 240_000 });
}

/** Logs the seeded emulator admin into the admin app. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto(ADMIN_URL);
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Login navigates away from /login when the admin_users lookup succeeds.
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}
