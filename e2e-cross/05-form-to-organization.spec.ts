import { test, expect } from '@playwright/test';
import { ADMIN_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: Forms -> Organizations - an inbound "Seminar Request"
// submission reviewed into a real Organization + Contact.
//
// Reseeds in beforeAll (BEFORE any login): the dedupe assertions ("appears
// once") are absolute, so a pristine world is genuinely required.
//
// SUBSTITUTION (noted per charter): the submission is created via the
// form_submissions ANONYMOUS WRITE CONTRACT (the exact rules-locked shape
// integration/rules/firestore-rules.test.js pins: formId/formName/
// fieldSnapshot/values/submittedAt/newRecordStatus, hasOnly - one extra key
// sinks the write), NOT through a public web page, because the web app has
// no reachable route that renders the SEEDED form:
//  - every app-dynamic-form usage hardcodes a formId that is a Firestore
//    doc id in the impactdisciplesdev project (e.g. seminar-form.component
//    .ts's 'SEp1UJlYaFDz50Nfe5Hh'), never the fixture's 'form-seminar';
//  - the fixture form's fields are keyed `key`, while the web renderer's
//    FormFieldDef/buildFormGroup are keyed `id`, so even an id match would
//    render a broken form.
// The REST create below carries NO auth header, so the emulator evaluates
// it under firestore.rules exactly like the public site's anonymous
// FormSubmissionService.add() - the same write path, same contract.

const FS_DOCS = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

const ORG_NAME = 'Riverbend Chapel';
const CONTACT = { firstName: 'Rita', lastName: 'Bend', email: 'rita@riverbend.test' };

test.describe.configure({ mode: 'serial' });

test.describe('seminar-request submission to organization + contact', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('an anonymous submission in the rules-locked shape is accepted', async () => {
    // Field ids/labels/types mirror the seeded "Seminar Request" form
    // definition (scripts/fixtures/emulator-fixtures.js form-seminar); the
    // labels are what the admin-side extraction heuristics
    // (shared/form-submission-mapping.util.ts) key on: "Church /
    // Organization" matches ORG_LABEL, "Coordinator Name" is the combined
    // person-name fallback, the email-type field carries the identity.
    const snapshot = (id: string, label: string, type: string) => ({
      mapValue: { fields: { id: { stringValue: id }, label: { stringValue: label }, type: { stringValue: type } } },
    });
    const res = await fetch(`${FS_DOCS}/form_submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no auth = anonymous under rules
      body: JSON.stringify({
        fields: {
          formId: { stringValue: 'form-seminar' },
          formName: { stringValue: 'Seminar Request' },
          fieldSnapshot: {
            arrayValue: {
              values: [
                snapshot('churchName', 'Church / Organization', 'text'),
                snapshot('coordinatorName', 'Coordinator Name', 'text'),
                snapshot('email', 'Email', 'email'),
                snapshot('city', 'City', 'text'),
                snapshot('state', 'State', 'text'),
              ],
            },
          },
          values: {
            mapValue: {
              fields: {
                churchName: { stringValue: ORG_NAME },
                coordinatorName: { stringValue: `${CONTACT.firstName} ${CONTACT.lastName}` },
                email: { stringValue: CONTACT.email },
                city: { stringValue: 'Macon' },
                state: { stringValue: 'GA' },
              },
            },
          },
          submittedAt: { timestampValue: new Date().toISOString() },
          newRecordStatus: { stringValue: 'new' },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  test('Form Submissions offers Create Organization + Contact and completes it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/contacts-manager?tab=custom-form-submissions`);

    // The list is paged newest-first (custom-form-submissions.component.ts)
    // and the Form column renders formName - the fresh submission is the
    // only row reading "Seminar Request" (the seeded sub-seminar-1 fixture
    // is in the legacy formTitle/data shape, so its Form column is blank).
    const row = page.locator('tr', { hasText: 'Seminar Request' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    // VIEW row action (visibility icon - data-grid.component.html renders
    // row actions as icon buttons).
    await row.locator('button:has(mat-icon:text-is("visibility"))').click();

    // Detail dialog (custom-form-submission-detail-dialog.component.html):
    // fieldSnapshot zipped with values, plus the org-qualified action.
    const detail = page.locator('mat-dialog-container', { hasText: 'SUBMISSION: Seminar Request' });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Church / Organization');
    await expect(detail).toContainText(ORG_NAME);
    await expect(detail).toContainText(CONTACT.email);
    await detail.getByRole('button', { name: 'CREATE ORGANIZATION + CONTACT' }).click();

    // Create dialog (shared/create-org-contact-dialog) - pre-filled by the
    // label heuristics; review, add the city the submission carried, save.
    const create = page.locator('mat-dialog-container', { hasText: 'CREATE ORGANIZATION + CONTACT' }).last();
    await expect(create.locator('section', { hasText: 'Organization' }).locator('input[formControlName="name"]')).toHaveValue(ORG_NAME);
    await expect(create.locator('input[formControlName="firstName"]').first()).toHaveValue(CONTACT.firstName);
    await expect(create.locator('input[formControlName="lastName"]').first()).toHaveValue(CONTACT.lastName);
    // contact email is the required matcher field.
    await expect(create.locator('section', { hasText: 'Point of Contact' }).locator('input[formControlName="email"]')).toHaveValue(CONTACT.email);

    // City/state came through as plain text fields (not an address-type
    // field), so the heuristics leave the org address empty - type the city
    // in the editable review form (app-address-field's City input).
    await create.locator('.address-field input[formControlName="city"]').fill('Macon');

    await create.getByRole('button', { name: 'CREATE / LINK' }).click();
    await expect(page.getByText('Organization and contact created')).toBeVisible({ timeout: 30_000 });

    // Back on the detail dialog the action flips to the created note.
    await expect(detail).toContainText('Organization + contact created from this request');
    // exact:true - the popup header's X is aria-labelled "Close" too.
    await detail.getByRole('button', { name: 'CLOSE', exact: true }).click();
  });

  test('the organization and the (deduped) contact now exist', async ({ page }) => {
    await loginAsAdmin(page);

    // Organizations (streamAll-backed list, organizations.component.ts).
    await page.goto(`${ADMIN_URL}/contacts-manager?tab=organizations`);
    const orgRow = page.locator('tr', { hasText: ORG_NAME });
    await expect(orgRow).toBeVisible({ timeout: 30_000 });
    await expect(orgRow).toContainText('Macon'); // City column
    await expect(orgRow).toContainText('Rita Bend'); // Point of Contact column

    // Contacts: Rita exists exactly once (email-deduped create).
    await page.goto(`${ADMIN_URL}/contacts-manager?tab=contacts`);
    const contactRows = page.locator('tr', { hasText: CONTACT.email });
    await expect(contactRows).toHaveCount(1, { timeout: 30_000 });
    await expect(contactRows.first()).toContainText('Rita');
    await expect(contactRows.first()).toContainText('Bend');
  });
});
