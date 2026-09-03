import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, queryEndpoint, seamed } from './support/harness';

// Charter area: Store -> Purchases -> Contacts, across both apps.
//
// No reseed here: nothing below asserts absolute counts - the buyer
// email/name are unique per run, the product pricing is seeded reference data
// no flow mutates, and the fulfillment walk operates only on the order this
// run creates. (Reseeding costs 30-60s and wipes Auth; see harness.ts.)
//
// The checkout itself is driven SERVER-SIDE (the same create_paypal_order
// free-order contract integration/money.test.js proves) rather than through
// the web checkout UI. Two reasons, BOTH of them now historical:
//  - the paid path died deterministically at the PayPal boundary (no
//    config doc);
//  - the web checkout page could not reach the payment step in the
//    emulator world at all: checkout.component.ts's calculateShippingCost()
//    reads `this.webConfig.freeShippingAmount`, the fixture world had no
//    `config` document, so webConfig was undefined and goToPayment() threw
//    before startOrder() ever ran.
// NEITHER is true since 2026-08-26 - the fixtures seed `config` and the
// vendors are redirected at scripts/fake-vendors.js - and the UI-driven PAID
// checkout now has its own spec, 13-paid-checkout.spec.ts. This file stays
// server-driven deliberately rather than duplicating it: its charter is what
// happens to an order AFTER it exists, and driving the storefront again here
// would only add minutes and a second place to break.
// So: cart UX is verified on the web store page (test 1), and the order is
// then created via the proven HTTP contract (test 2) and picked up in the
// ADMIN UI end-to-end from there.

const FN_BASE = 'http://127.0.0.1:5001/demo-impact/us-central1';
const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

// Unique per run so re-runs (and pre-existing worlds - no reseed) can never
// collide on the purchases/customers assertions below. Lastname starts with
// "Aa" so the Contacts page (paged, orderBy lastName ASC - see
// contacts.component.ts) is guaranteed to have it on page 1.
const RUN_TAG = Date.now().toString(36);
const BUYER_EMAIL = `buyer-${RUN_TAG}@cross.test`;
const BUYER_FIRST = 'Freeflow';
const BUYER_LAST = `Aabuyer${RUN_TAG}`;

let purchaseId: string;

async function fnPost(name: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body: parsed };
}

// Emulator-owner Firestore REST read (the emulator grants "Bearer owner"
// full access) - used only to WAIT for slow trigger side effects before
// asserting them in the real admin UI, never as the assertion itself.
async function fsGetDoc(path: string): Promise<any | null> {
  // seamed(): purchases live under the tenant since 2026-09-02.
  const res = await fetch(`${FS_BASE}/${seamed(path)}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fsQueryByField(collection: string, field: string, value: string): Promise<any[]> {
  const res = await fetch(queryEndpoint(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
      },
    }),
  });
  const rows = (await res.json()) as Array<{ document?: unknown }>;
  return rows.filter((r) => r.document).map((r) => r.document);
}

async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// The whole file is one flow: a later test is meaningless after an earlier
// failure, so serial (skip-remaining) beats independent reruns here.
test.describe.configure({ mode: 'serial' });

test.describe('store pricing and cart, order to fulfillment, contact upsert', () => {
  test('web store shows the undiscounted price and adding to cart updates the header badge', async ({ page }) => {
    await page.goto(`${WEB_URL}/store`);

    // The page lands in "SHOP BY SERIES" view; the Sort By <select>
    // (id="storeSort", store.component.html) switches to the flat product
    // list. Option text is "All" (store.component.ts filterOptions).
    // WAIT for the product stream to land first: when it emits,
    // applyCategoryFromUrl() re-runs filterProducts(viewBySeries), which
    // would silently undo an "All" selection made too early - the seeded
    // "M-7 Series" tile appearing means that reset has already happened.
    await expect(page.getByRole('button', { name: 'M-7 Series' })).toBeVisible({ timeout: 30_000 });
    await page.selectOption('#storeSort', { label: 'All' });

    // Product card (store-postbox-item.component.html). Campaign Manager v3
    // retired the sitewide sale, and no campaign offer targets this product,
    // so it shows its plain cost with NO struck-through price beside it.
    // The offer-driven discount has its own spec (09-campaign-offer-to-
    // storefront) - what this pins is that an untargeted product is left
    // alone, which the old global sale could never have shown.
    const card = page.locator('.product', { hasText: 'Disciple-Making Field Guide' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    // The card renders the currency with a space ("$ 20.00"); the cart badge
    // below does not. Both pinned exactly as they appear.
    await expect(card).toContainText('$ 20.00');
    await expect(card.locator('s')).toHaveCount(0);

    // "ADD" is an <a role="button"> with a cart-plus icon
    // (store-postbox-item.component.html).
    await card.getByRole('button', { name: 'ADD' }).click();

    // Header cart badge (home-header.component.html): "Cart (n) — $total".
    await expect(page.locator('.header__content-cart')).toContainText('(1)');
    await expect(page.locator('.header__content-cart')).toContainText('$20.00');
  });

  test('a FREE100 event order lands in admin Purchases and a fulfillment step can be advanced', async ({ page }) => {
    // Same free-order body integration/money.test.js proves: event items
    // are never on sale, so FREE100 zeroes the order server-side and the
    // purchase doc is written immediately (no PayPal involved).
    const res = await fnPost('create_paypal_order', {
      firstName: BUYER_FIRST,
      lastName: BUYER_LAST,
      email: BUYER_EMAIL,
      phone: '555-0000',
      isShippingSameAsBilling: true,
      // Non-Georgia address keeps the network-reliant tax lookup out of
      // play (tax only computes for state === "Georgia") - money.test.js.
      shippingAddress: { address1: '1 Alamo Plz', city: 'San Antonio', state: 'Texas', zip: '78205', country: 'US' },
      shippingRate: 0,
      couponCode: 'FREE100',
      cartItems: [{ id: 'event-workshop', isEvent: true, orderQuantity: 1 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.free).toBe(true);
    purchaseId = res.body.checkoutForm.id;
    expect(purchaseId).toBeTruthy();

    // The onPurchaseFulfillmentEligible trigger stamps fulfillmentStatus
    // asynchronously - wait for it before loading the admin UI so the
    // Status column/action bar are stable. NOTE (documented behavior, not
    // a workaround): an event-only order has no physical item, so the
    // trigger stamps it "closed" AT CREATION - there is no forward step
    // available on a fresh free event order. The admin flow below therefore
    // exercises the step machinery the way the UI actually offers it for
    // this order: Reopen / Move Back to "Received", then advance
    // Received -> Closed via "Mark as Picked Up / Delivered".
    await pollUntil(async () => {
      const doc = await fsGetDoc(`purchases/${purchaseId}`);
      return doc?.fields?.fulfillmentStatus?.stringValue ? doc : null;
    }, 'fulfillmentStatus stamp on the new purchase');

    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/contacts-manager?tab=purchases`);

    // Purchases list is paged newest-first (dateProcessed DESC,
    // purchases.component.ts) - the fresh order is on page 1. Email column
    // is visible by default.
    const row = page.locator('tr', { hasText: BUYER_EMAIL });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Closed');

    // Row double-click opens the full-page edit view
    // (purchases.component.html -> app-purchase-details).
    await row.dblclick();
    await expect(page.getByText('This order is closed.')).toBeVisible({ timeout: 20_000 });

    // Reopen to "Received" (purchase-details.component.html's closed-state
    // "Reopen / Move Back" menu), confirming through the shared confirm
    // dialog (confirm-dialog.component.html: CANCEL / OK).
    await page.getByRole('button', { name: 'Reopen / Move Back' }).click();
    await page.getByRole('menuitem', { name: 'Received', exact: true }).click();
    const confirmDialog = page.locator('mat-dialog-container', { hasText: 'Move Back a Step' });
    await expect(confirmDialog).toContainText('Reopen this order');
    await confirmDialog.getByRole('button', { name: 'OK' }).click();

    // Now at 'received': the real forward actions render.
    await expect(page.getByText('Order moved back to Received')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as Picked Up / Delivered' })).toBeVisible();

    // Advance one fulfillment step (received -> closed, the
    // pickup/hand-delivery jump - no confirm dialog on this one).
    await page.getByRole('button', { name: 'Mark as Picked Up / Delivered' }).click();
    await expect(page.getByText('Marked as picked up / delivered - order closed')).toBeVisible();
    await expect(page.getByText('This order is closed.')).toBeVisible();
  });

  test('the buyer now exists in admin Contacts (customer auto-upsert)', async ({ page }) => {
    // customer-upsert.functions.ts creates the customers doc from the
    // purchase write - trigger drain can be slow in the emulator, so wait
    // for the doc to exist before asserting it through the real UI.
    await pollUntil(async () => {
      const docs = await fsQueryByField('customers', 'email', BUYER_EMAIL);
      return docs.length > 0 ? docs : null;
    }, 'customer upsert for the buyer');

    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/contacts-manager?tab=contacts`);

    // Contacts is paged orderBy lastName ASC (contacts.component.ts);
    // the buyer's "Aa..." lastname pins it to page 1.
    const row = page.locator('tr', { hasText: BUYER_EMAIL });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(BUYER_FIRST);
    await expect(row).toContainText(BUYER_LAST);
  });
});
