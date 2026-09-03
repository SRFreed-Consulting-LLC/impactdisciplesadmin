import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Page, expect } from '@playwright/test';
// ONE seam, borrowed rather than restated - the same list the app compiles in.
import { tenantPath } from '../../src/common/src/shared/lists/tenancy';

// Shared helpers for the ADMIN-ONLY emulator E2E suite.
//
// Distinct from e2e/ (which points at the live dev project with the owner's
// real credentials and is a hand-run smoke layer) and from e2e-cross/
// (which boots all three apps for flows that genuinely span them). This
// suite boots ONE dev server against the emulator, so it is the fastest
// layer that can still prove an admin screen actually works in a browser.
//
// Everything here targets the seeded emulator accounts in
// scripts/fixtures/emulator-fixtures.js - never real credentials, never a
// real Firebase project.

export const ADMIN_URL = 'http://localhost:5201';
export const ADMIN_EMAIL = 'admin@test.local';
export const EMPLOYEE_EMAIL = 'employee@test.local';
export const PASSWORD = 'test-password-1';

/** Deterministic fixture ids this suite asserts against. */
export const FIXTURES = {
  liveCampaign: 'camp-live',
  liveCampaignName: 'Fall Workbook Push',
  pastCampaign: 'camp-past',
  pastCampaignName: 'Spring Newsletter',
  pastTouch: 'cemail-past-1',
  pastTouchLabel: 'March issue',
  summitEvent: 'event-summit-2027',
  /** The product camp-live spotlights - its title seeds that campaign's email starter. */
  followUpProductTitle: 'Coaching Workbook',
  digitalProduct: 'prod-book-digital',
  retiredProduct: 'prod-retired',
  libraryBook: 'lib-book-0001',
} as const;

/**
 * Wipe-first reseed of the emulator world. Slow (~30-60s: seed-emulator.js
 * deliberately waits for the trigger backlog to go quiet) and it wipes
 * AUTH, so it kills any signed-in browser session. Call it in beforeAll,
 * BEFORE any login, and at most once per spec file.
 *
 * Most specs in this suite are read-only and do NOT need this - only the
 * ones that write (campaign email authoring, store CRUD) reseed, so the
 * suite stays quick.
 */
export function reseedEmulator(): void {
  execFileSync(
    process.execPath,
    [path.join(__dirname, '..', '..', 'scripts', 'seed-emulator.js')],
    { stdio: 'pipe', timeout: 240_000 },
  );
}

/** Signs the seeded Admin into the admin app and waits for the shell. */
export async function loginAsAdmin(page: Page, email = ADMIN_EMAIL): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // Login clears /login once the admin_users lookup resolves the role.
  await expect(page).not.toHaveURL(/login/, { timeout: 25_000 });
}

/**
 * Deep-links straight to a manager screen's tab. Every manager is a tab
 * shell keyed by ?tab=<slug> (nav-config.ts owns those slugs), so this is
 * the fast path - it skips driving the left nav, which nav-and-settings
 * already covers on its own.
 */
export async function gotoTab(page: Page, manager: string, tab: string): Promise<void> {
  await page.goto(`${ADMIN_URL}/${manager}?tab=${tab}`);
}

/**
 * Waits for a shared app-data-grid to finish its first load. The grid
 * renders its table element immediately and fills rows from a Firestore
 * stream, so "table is visible" is NOT enough - an empty grid and a
 * still-loading grid look identical. Resolves on the first data row, or on
 * the explicit empty state.
 */
export async function waitForGrid(page: Page, tableClass: string): Promise<number> {
  const table = page.locator(`.${tableClass}`);
  await table.waitFor({ timeout: 30_000 });
  await expect
    .poll(async () => {
      if (await dataRows(page, tableClass).count() > 0) return 'rows';
      return (await table.locator('td.empty-state').count()) > 0 ? 'empty' : 'loading';
    }, { timeout: 30_000 })
    .not.toBe('loading');
  return dataRows(page, tableClass).count();
}

/**
 * The DATA rows of a shared app-data-grid, and only those.
 *
 * Written against structure rather than Material's class names because the
 * naive `tbody tr` is actively wrong here: `*matNoDataRow` always renders a
 * <tr> into the tbody, and while the grid is still loading that row is
 * EMPTY - no cells at all, since its content sits behind
 * `@if ((loading$ | async) === false)`. Counting it made every grid look
 * like it had exactly one row the instant the table element appeared, so
 * waits returned immediately and assertions ran against an unloaded grid.
 * (That cost four false failures on this suite's first run.)
 *
 * So: a data row is a <tr> that has cells and is not the empty-state row.
 */
export function dataRows(page: Page, tableClass: string) {
  return page.locator(`.${tableClass} tbody tr:has(td):not(:has(td.empty-state))`);
}

/**
 * Collects browser console errors for the duration of a test. A screen that
 * renders but throws on every change-detection cycle is broken even when
 * every assertion passes, and that is exactly the failure mode a lazy-module
 * refactor produces - so the campaign specs assert on this.
 *
 * Filtered: Firestore's WebChannel transport noise on a cold emulator
 * connection is expected and unrelated (see FirebaseDAO's retry comment).
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/WebChannelConnection|transport errored|@firebase\/firestore.*Connection/i.test(text)) return;
    // The email builder previews into a deliberately sandboxed iframe with
    // no allow-scripts - Chrome logs a console error for every script the
    // previewed document contains. That is the sandbox WORKING; treating it
    // as a page error would make the campaign editor permanently red.
    if (/Blocked script execution in 'about:blank'|frame is sandboxed/i.test(text)) return;
    // NOTE: a filter for get_youtube_videos 502s lived here until
    // 2026-08-21. The emulator runs on deliberately FAKE vendor credentials
    // (scripts/write-emulator-env.js), so anything calling a real third
    // party fails by design - and the admin Pod Casts screen did. That
    // screen is gone (podcasts now come straight from YouTube on the public
    // site), and no admin screen calls a vendor API any more, so the
    // exemption went with it. Add one back only alongside the screen that
    // needs it.
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err?.message ?? err)));
  return errors;
}

/**
 * Firestore-emulator REST read, admin-privileged via the emulator's
 * `Bearer owner` bypass. Same trust level as the integration suite's Admin
 * SDK writes, and impossible outside an emulator. Used sparingly here -
 * when a spec needs to prove a WRITE landed, not just that the UI claimed
 * it did.
 */
export const FIRESTORE_REST =
  'http://127.0.0.1:8080/v1/projects/demo-impact/databases/(default)/documents';

/**
 * THROUGH THE TENANCY SEAM, so a caller cannot name a moved collection.
 *
 * These helpers take a bare collection name and talk to the emulator's REST
 * API directly - which means they bypass every seam the app itself goes
 * through. `listDocs('campaign_emails')` therefore read the pre-migration
 * flat path and found nothing, while the app was writing correctly under
 * tenants/impactdisciples.com. The spec reported "the draft was never
 * saved"; the draft was saved, and the very next spec reopened it happily.
 *
 * The unseamed-access guard does scan e2e-admin/, but it looks for Firestore
 * CALL SHAPES - a bare collection name handed to a helper is invisible to
 * it. Routing it here means no caller has to remember.
 */
function seamed(collectionPath: string): string {
  const [head, ...rest] = collectionPath.split('/');
  return [tenantPath(head), ...rest].join('/');
}

export async function readDoc(collectionPath: string, id: string): Promise<any | null> {
  const res = await fetch(`${FIRESTORE_REST}/${seamed(collectionPath)}/${id}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function listDocs(collectionPath: string): Promise<any[]> {
  const res = await fetch(`${FIRESTORE_REST}/${seamed(collectionPath)}?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return body?.documents ?? [];
}

/** Unwraps a Firestore REST value map into plain JS (shallow - enough here). */
export function fields(doc: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries<any>(doc?.fields ?? {})) {
    out[k] =
      v.stringValue ?? v.booleanValue ?? v.timestampValue ??
      (v.integerValue !== undefined ? Number(v.integerValue) : undefined) ??
      (v.doubleValue !== undefined ? Number(v.doubleValue) : undefined) ??
      v.mapValue ?? v.arrayValue ?? null;
  }
  return out;
}
