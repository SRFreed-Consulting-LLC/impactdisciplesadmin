import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Page, expect } from '@playwright/test';

// Shared helpers for the cross-app emulator flows. Everything here targets
// the SEEDED EMULATOR accounts (scripts/fixtures/emulator-fixtures.js) -
// never real credentials, never a real Firebase project.

export const ADMIN_URL = 'http://localhost:5200';
export const WEB_URL = 'http://localhost:4200';
export const READER_URL = 'http://localhost:4300';
export const ADMIN_EMAIL = 'admin@test.local';
export const ADMIN_PASSWORD = 'test-password-1';
export const PATRON_EMAIL = 'patron@test.local';
export const PATRON_PASSWORD = 'test-password-1';

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

/**
 * Logs the seeded patron into the READER app (impact-discipleship-library-new
 * on :4300). Its login screen is Material reactive forms (login.component.html)
 * - matInput type=email / type=password + a "Sign in" submit; success
 * navigates to the dashboard shell at '/'.
 */
export async function loginAsPatron(page: Page, email = PATRON_EMAIL): Promise<void> {
  await page.goto(`${READER_URL}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PATRON_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

/**
 * Firestore-emulator REST helpers, admin-privileged via the emulator's
 * `Bearer owner` bypass (test-harness plumbing, same trust level as the
 * integration suite's Admin SDK writes - never usable outside an emulator).
 */
export const FIRESTORE_REST =
  'http://127.0.0.1:8080/v1/projects/demo-impact/databases/(default)/documents';

export async function firestoreOwnerFetch(
  pathAndQuery: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${FIRESTORE_REST}/${pathAndQuery}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
