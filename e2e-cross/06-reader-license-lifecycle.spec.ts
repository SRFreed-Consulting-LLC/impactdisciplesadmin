import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, READER_URL, loginAsAdmin, loginAsPatron, reseedEmulator } from './support/harness';

// Charter area: admin <-> reader license lifecycle. The admin's Library
// Users screen grants/revokes an "admin-grant" book license (the
// grantLibraryUserLicenses / revokeAdminGrantedLicense callables, already
// integration-tested server-side in integration/library-licenses.test.js);
// this proves the same lifecycle END TO END through both real UIs: the
// reader's book list and - the strong part - its unit/lesson content reads,
// which firestore.rules license-gates per book (canReadBook on the nested
// librarySeries/{s}/books/{b}/units path). A rendered unit list IS proof
// the flat-id grant landed; the books-list is only client-side filtering.
//
// Seeded starting truth (scripts/fixtures/emulator-fixtures.js):
// patron@test.local holds lib-book-0001 ("Foundations of Disciple-Making")
// and NOT lib-book-0002 ("Advanced Multiplication"). Both books live under
// "Foundations Series".
//
// Each test uses a fresh browser context (Playwright default), so the
// reader's persistent Firestore cache starts empty every time - no stale
// local-cache reads to worry about across the admin-side writes between
// tests. (A same-page flow would need a reload instead - the reader caches
// aggressively for offline use.)

const PATRON = 'patron@test.local';
const BOOK1_TITLE = 'Foundations of Disciple-Making';
const BOOK2_TITLE = 'Advanced Multiplication';
const BOOK2_ID = 'lib-book-0002';

/** Opens the reader's My Books page and expands the (collapsed-by-default)
 *  series group so book titles are actually in the DOM. */
async function openBooksList(page: Page): Promise<void> {
  await page.goto(`${READER_URL}/books`);
  const seriesToggle = page.locator('button.section-toggle', { hasText: 'Foundations Series' });
  await expect(seriesToggle).toBeVisible({ timeout: 20_000 });
  await seriesToggle.click();
}

/** Admin: opens the patron's Library Users detail page. */
async function openPatronDetail(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(`${ADMIN_URL}/library-manager?tab=library-users`);
  const row = page.locator('tr', { hasText: PATRON });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/library-users\/patron%40test\.local|library-users\/patron@test\.local/);
  // The Book licenses card is on the detail page - wait for it to load.
  await expect(page.getByRole('heading', { name: 'Book licenses' })).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('admin license grant/revoke reflected in the reader', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('the patron library lists the licensed book only', async ({ page }) => {
    await loginAsPatron(page);
    await openBooksList(page);

    await expect(page.getByText(BOOK1_TITLE)).toBeVisible();
    // Book METADATA is deliberately signedIn-readable (Impact Groups browse
    // books the patron doesn't own), so this asserts on the patron's OWN
    // library list specifically: the expanded My Books series group.
    await expect(page.getByText(BOOK2_TITLE)).toHaveCount(0);
    // Count chip on the series header agrees: 1 licensed book.
    await expect(
      page.locator('button.section-toggle', { hasText: 'Foundations Series' }),
    ).toContainText('(1)');
  });

  test('the admin grants the second book from the Library Users screen', async ({ page }) => {
    await openPatronDetail(page);

    await page.getByRole('button', { name: 'Grant licenses' }).click();
    const dialog = page.locator('mat-dialog-container', { hasText: 'Grant book licenses' });
    await expect(dialog).toBeVisible();

    // The already-held book renders checked-and-disabled - never re-grantable.
    await expect(
      dialog.locator('mat-checkbox', { hasText: BOOK1_TITLE }).locator('input'),
    ).toBeDisabled();
    // Click the checkbox's LABEL - a click on the mat-checkbox host element
    // itself lands on wrapper padding and doesn't toggle (live-run finding).
    await dialog.locator('mat-checkbox', { hasText: BOOK2_TITLE }).locator('label').click();
    await expect(
      dialog.locator('mat-checkbox', { hasText: BOOK2_TITLE }).locator('input'),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Grant 1 license' }).click();

    // Dialog closes on success and the snackbar names the granted title.
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await expect(page.locator('simple-snack-bar')).toContainText(BOOK2_TITLE);

    // The detail page's live listener re-renders the license table with the
    // new admin-grant row.
    const licenseRow = page.locator('table.licenses-table tr', { hasText: BOOK2_TITLE });
    await expect(licenseRow).toBeVisible({ timeout: 20_000 });
    await expect(licenseRow).toContainText('Admin grant');
  });

  test('the reader now lists the book AND renders its rules-gated content', async ({ page }) => {
    await loginAsPatron(page);
    await openBooksList(page);

    await expect(
      page.locator('button.section-toggle', { hasText: 'Foundations Series' }),
    ).toContainText('(2)');
    await page.getByText(BOOK2_TITLE).click();

    // Book detail: the unit/lesson list read is a nested-path query that
    // firestore.rules license-gates (canReadBook) - it RENDERING is proof
    // the flat licensedBookIds grant landed server-side, not just client
    // filtering.
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK2_ID}`));
    await expect(page.getByRole('heading', { name: BOOK2_TITLE })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Unit 1: Multiplying Movements')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Lesson 1: Beyond Addition')).toBeVisible();
  });

  test('the admin revokes the grant', async ({ page }) => {
    await openPatronDetail(page);

    const licenseRow = page.locator('table.licenses-table tr', { hasText: BOOK2_TITLE });
    await expect(licenseRow).toBeVisible({ timeout: 20_000 });
    await licenseRow.locator('button:has(mat-icon:text-is("delete_outline"))').click();

    // Shared admin confirm dialog (confirm-dialog.component.html): OK/CANCEL.
    const confirm = page.locator('mat-dialog-container', { hasText: 'Remove the admin-granted license' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'OK' }).click();

    await expect(page.locator('simple-snack-bar')).toContainText('removed');
    await expect(licenseRow).toHaveCount(0, { timeout: 20_000 });
  });

  test('the reader loses the book, and its direct URL is access-denied', async ({ page }) => {
    await loginAsPatron(page);
    await openBooksList(page);

    await expect(page.getByText(BOOK1_TITLE)).toBeVisible();
    await expect(page.getByText(BOOK2_TITLE)).toHaveCount(0);
    await expect(
      page.locator('button.section-toggle', { hasText: 'Foundations Series' }),
    ).toContainText('(1)');

    // Directly-addressed content is blocked SERVER-side: book-detail's units
    // query rejects under canReadBook and the component renders its
    // access-denied state (book-detail.component.ts catchError).
    await page.goto(`${READER_URL}/books/${BOOK2_ID}`);
    await expect(
      page.getByText("You don't have access to this book. Contact us to purchase access."),
    ).toBeVisible({ timeout: 20_000 });
  });
});
