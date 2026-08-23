import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, READER_URL, loginAsAdmin, loginAsPatron, reseedEmulator } from './support/harness';

// Charter area: admin -> reader announcement messaging, and account-level
// access revocation (setLibraryUserRevoked - disables the Firebase Auth
// user and stamps libraryUsers.revoked; server-side behavior already
// integration-tested in integration/library-licenses.test.js). This proves
// the surrounding UX end to end:
//
//  - Admin sends a message from the Library Users detail page -> the patron
//    sees it UNREAD in the reader inbox, expanding marks it read (the only
//    owner-permitted update under firestore.rules), and delete is offered
//    only once read (rules: `allow delete ... resource.data.read == true` -
//    an unread announcement can't be dismissed unseen).
//  - Admin revokes ACCOUNT access -> a fresh reader login is refused (the
//    function disables the Auth user; an already-signed-in SPA's ID token
//    can stay valid for up to an hour, so the login refusal is the
//    strongest promptly-observable truth). Restore -> login works again.

const PATRON = 'patron@test.local';
const MSG_TITLE = 'Summit prep window E2E-07';
const MSG_BODY = 'Distinctive body for the cross-app inbox flow: please review unit two before Friday.';

/** Admin: opens the patron's Library Users detail page. */
async function openPatronDetail(page: Page): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(`${ADMIN_URL}/library-manager?tab=library-users`);
  const row = page.locator('tr', { hasText: PATRON });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // DOUBLE click: the Library Users grid navigates on (rowDoubleClick),
  // like every other app-data-grid. A single click selects and goes
  // nowhere, which is why this waited 30s for a detail page that was
  // never coming.
  await row.dblclick();
  await expect(page.getByRole('heading', { name: 'Book licenses' })).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('admin message to reader inbox, then account revoke/restore', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('the admin sends the patron a message', async ({ page }) => {
    await openPatronDetail(page);

    await page.getByRole('button', { name: 'Send message' }).click();
    const dialog = page.locator('mat-dialog-container', { hasText: 'Send message' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Pat Patron');

    await dialog.getByRole('textbox', { name: 'Title' }).fill(MSG_TITLE);
    await dialog.getByRole('textbox', { name: 'Message' }).fill(MSG_BODY);
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    // Callable resolves -> dialog closes; the patron has no FCM token in the
    // seed, so the snackbar reports the inbox-only outcome. Generous wait:
    // the send legitimately takes 15s+ on a loaded emulator (recipient
    // paging + sender lookup + inbox write), and 20s flaked in full-suite
    // runs.
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    await expect(page.locator('simple-snack-bar')).toContainText('Message sent');
  });

  test('the patron reads it (unread -> read) and can delete it only after', async ({ page }) => {
    await loginAsPatron(page);
    await page.goto(`${READER_URL}/messages`);

    const card = page.locator('mat-card.message-card', { hasText: MSG_TITLE });
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Unread state: "New" chip, no delete button (rules forbid deleting an
    // unread message, and the UI doesn't offer it).
    await expect(card.locator('.new-chip')).toBeVisible();
    await expect(card.locator('button.delete-button')).toHaveCount(0);

    // Expanding is what marks it read - body renders, and once the read
    // flip lands (live listener re-emit) the New chip drops and the delete
    // affordance appears.
    await card.locator('button.message-toggle').click();
    await expect(card).toContainText(MSG_BODY);
    await expect(card.locator('.new-chip')).toHaveCount(0, { timeout: 20_000 });

    const deleteButton = card.locator('button.delete-button');
    await expect(deleteButton).toBeVisible({ timeout: 20_000 });
    await deleteButton.click();

    // Reader confirm dialog (confirm-dialog.component.ts) - confirmLabel is
    // 'Delete' for this action.
    const confirm = page.locator('mat-dialog-container', { hasText: 'Delete this message?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    // The delete write is only accepted because read == true persisted -
    // the card leaving the live list proves the rules-gated delete landed.
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('No messages yet.')).toBeVisible();
  });

  test('the admin revokes the patron account', async ({ page }) => {
    await openPatronDetail(page);

    await page.getByRole('button', { name: 'Revoke access' }).click();
    // ConfirmService dialog: title "Revoke access", message "Revoke Pat
    // Patron's access? ..." (library-user-detail.component.ts).
    const confirm = page.locator('mat-dialog-container', { hasText: "Revoke Pat Patron's access?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'OK' }).click();

    // The revoked chip on the detail header is the DURABLE truth (the live
    // doc re-emit) - assert it first with patience; the snackbar is
    // transient (it auto-dismisses), so it only gets checked while the
    // callable's own wait already succeeded quickly.
    await expect(page.locator('mat-chip', { hasText: 'Access revoked' })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('a fresh reader login is refused while revoked', async ({ page }) => {
    // setLibraryUserRevoked disables the Firebase Auth account and revokes
    // refresh tokens. An existing session's ID token can outlive that by up
    // to an hour (nothing observable within a test's patience), so the
    // strongest observable is a FRESH login attempt: auth/user-disabled.
    await page.goto(`${READER_URL}/login`);
    await page.fill('input[type="email"]', PATRON);
    await page.fill('input[type="password"]', 'test-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // LoginComponent.friendlyError: user-disabled isn't one of the
    // bad-credential codes, so the generic failure message renders and the
    // page stays on /login.
    await expect(page.locator('p.error')).toHaveText('Something went wrong. Please try again.', {
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/login/);
  });

  test('restore brings the patron back', async ({ page }) => {
    await openPatronDetail(page);

    await page.getByRole('button', { name: 'Restore access' }).click();
    const confirm = page.locator('mat-dialog-container', { hasText: "Restore Pat Patron's access?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('simple-snack-bar')).toContainText('Access restored');

    // Reader: the same credentials sign in again and land on the shell.
    await loginAsPatron(page);
    await expect(page.getByText('My Books')).toBeVisible({ timeout: 20_000 });
  });
});
