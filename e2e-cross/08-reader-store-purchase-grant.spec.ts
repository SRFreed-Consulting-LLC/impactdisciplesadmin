import { test, expect, Page } from '@playwright/test';
import { READER_URL, firestoreOwnerFetch, loginAsPatron, reseedEmulator } from './support/harness';

// Charter area: Store -> Library seam, purchase side. A digital-book
// purchase landing in `purchases` fires onPurchaseGrantLibraryLicenses
// (library-license-grant.functions.ts), which grants the reader-app license
// (flat licensedBookIds + a source:'store-purchase' provenance entry) - and
// the patron can actually READ the book in the reader, rules-gated.
//
// The purchase doc is written directly (emulator-owner REST - same trust
// level as the integration suite's Admin SDK writes) mirroring
// integration/library-licenses.test.js's digitalPurchase() shape: driving
// the public web checkout is 01-store-to-fulfillment's charter, and the
// trigger only reads the purchase doc. NOTE the cart item carries
// digitalBookId 'lib-book-0002', NOT the fixture product's own
// 'lib-book-0001': the trigger deliberately trusts the cart item's copied
// digitalBookId (checkout copies it from the product; it never re-reads
// `products`), the patron already holds lib-book-0001, and only
// lib-book-0002 gives a visible before/after in the reader.

const PATRON = 'patron@test.local';
const BOOK2_ID = 'lib-book-0002';
const BOOK2_TITLE = 'Advanced Multiplication';
const PURCHASE_ID = 'cross-08-purchase-0001';

/**
 * Opens the reader's library and makes sure the series shelf is EXPANDED.
 *
 * Ensures rather than toggles: the shelf now opens expanded, so a blind click
 * closed it and hid every book - which reads exactly like the books being
 * missing. aria-expanded is the shelf's own answer, so ask it.
 */
async function openBooksList(page: Page): Promise<void> {
  await page.goto(`${READER_URL}/books`);
  const seriesToggle = page.locator('button.shelf-toggle', { hasText: 'Foundations Series' });
  await expect(seriesToggle).toBeVisible({ timeout: 20_000 });

  if ((await seriesToggle.getAttribute('aria-expanded')) !== 'true') {
    await seriesToggle.click();
  }
  await expect(seriesToggle).toHaveAttribute('aria-expanded', 'true');
}

/** The patron's libraryUsers doc via emulator-owner REST (rules-bypassing
 *  read, test plumbing only). */
async function patronLibraryUser(): Promise<any> {
  const res = await firestoreOwnerFetch(`libraryUsers/${encodeURIComponent(PATRON)}`);
  return res.status === 200 ? res.body : null;
}

test.describe.configure({ mode: 'serial' });

test.describe('store purchase grants a reader license via the purchases trigger', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('baseline: the patron does not have the book', async ({ page }) => {
    await loginAsPatron(page);
    await openBooksList(page);
    await expect(
      page.locator('button.shelf-toggle', { hasText: 'Foundations Series' }),
    ).toContainText('(1)');
    await expect(page.getByText(BOOK2_TITLE)).toHaveCount(0);
  });

  test('a digital-book purchase doc triggers the license grant', async () => {
    // Mirror of integration/library-licenses.test.js's digitalPurchase()
    // shape, in Firestore REST typed-value form.
    const create = await firestoreOwnerFetch(`purchases?documentId=${PURCHASE_ID}`, {
      method: 'POST',
      body: {
        fields: {
          email: { stringValue: PATRON },
          firstName: { stringValue: 'Pat' },
          lastName: { stringValue: 'Patron' },
          dateProcessed: { timestampValue: new Date().toISOString() },
          cartItems: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      id: { stringValue: 'prod-book-digital' },
                      isDigitalBook: { booleanValue: true },
                      digitalBookId: { stringValue: BOOK2_ID },
                      orderQuantity: { integerValue: '1' },
                      language: { stringValue: 'en' },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(create.status).toBe(200);

    // The onDocumentCreated trigger drains through the Functions emulator -
    // poll the libraryUsers doc for the flat id + provenance entry.
    const deadline = Date.now() + 90_000;
    let doc: any = null;
    for (;;) {
      doc = await patronLibraryUser();
      const ids = (doc?.fields?.licensedBookIds?.arrayValue?.values ?? []).map(
        (v: any) => v.stringValue,
      );
      if (ids.includes(BOOK2_ID)) break;
      if (Date.now() > deadline) {
        throw new Error(`license never granted; licensedBookIds = ${JSON.stringify(ids)}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Provenance: a store-purchase entry pointing back at THIS purchase.
    const licenses = (doc.fields.bookLicenses?.arrayValue?.values ?? []).map(
      (v: any) => v.mapValue.fields,
    );
    const entry = licenses.find((l: any) => l.bookId?.stringValue === BOOK2_ID);
    expect(entry).toBeTruthy();
    expect(entry.source.stringValue).toBe('store-purchase');
    expect(entry.storePurchaseId.stringValue).toBe(PURCHASE_ID);
    expect(entry.language.stringValue).toBe('en');
  });

  test('the reader lists the purchased book and renders its content', async ({ page }) => {
    await loginAsPatron(page);
    await openBooksList(page);

    await expect(
      page.locator('button.shelf-toggle', { hasText: 'Foundations Series' }),
    ).toContainText('(2)');
    await page.getByText(BOOK2_TITLE).click();

    // The unit/lesson list read is license-gated server-side (canReadBook) -
    // it rendering proves the store-purchase grant is a real, rules-visible
    // license, same standard as 06.
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK2_ID}`));
    await expect(page.getByRole('heading', { name: BOOK2_TITLE })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Unit 1: Multiplying Movements')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Lesson 1: Beyond Addition')).toBeVisible();
  });

  // Deliberately out of scope: revocation via the store REFUND path - that
  // lives on the admin Purchases screen's refund flow (PayPal sandbox
  // dependencies), not this trigger. Admin-grant revocation round-trips are
  // covered by 06.
});
