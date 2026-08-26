import { test, expect, Page } from '@playwright/test';
import { WEB_URL, firestoreOwnerFetch, reseedEmulator } from './support/harness';

// Charter area: the PAID storefront checkout, driven through the real web UI
// on :4200, end to end - cart, shipping quote, tax, and a PayPal order.
//
// WHY THIS SPEC IS NEW
// This flow could not be run in the emulator at all until 2026-08-26.
// 01-store-to-fulfillment's header still records why: the fixture world had
// no `config` document, so checkout.component.ts's calculateShippingCost()
// read an undefined webConfig.freeShippingAmount and goToPayment() threw
// before startOrder() ever ran - and even past that, create_paypal_order died
// at getPaypalClientId(). So the storefront's own money flow was verified
// only by calling the HTTP function directly; the PAGE that customers
// actually use was never driven past the cart.
//
// Two things changed: the fixtures seed `config`, and PayPal / apilayer /
// ShipEngine are redirected at scripts/fake-vendors.js. Nothing here reaches
// a real vendor, and no card is ever charged.
//
// WHERE THIS STOPS, and why: the PayPal BUTTON is PayPal's own JS SDK,
// loaded from paypal.com and driven by a buyer approving a payment in
// PayPal's iframe. That cannot be automated, which is the same reason
// capture has no UI test anywhere. So this spec ends where a human takes
// over - at the widget being mounted against a server-created order id -
// and capture itself is covered server-side in
// integration/vendor-money.test.js.

const FAKE_VENDORS = 'http://127.0.0.1:5055';

const PRODUCT_TITLE = 'Disciple-Making Field Guide';
const BUYER = {
  firstName: 'Paige',
  lastName: 'Payer',
  email: `paid-${Date.now().toString(36)}@cross.test`,
  phone: '5555550123',
};

// Georgia, so tax is actually computed at all - checkout-pricing only looks
// a rate up for Georgia addresses.
//
// The zip is UNIQUE PER RUN, and that matters. A successful rate is cached
// per zip inside the warm function instance for 12 hours, so a fixed zip is
// already cached by the time this spec runs after the integration suite -
// and the assertion below that the tax service was actually called then
// fails, claiming the lookup never happened when really it happened earlier
// and was correctly reused. An unmapped Georgia zip falls through to the
// fake's default rate (8%), which is just as deterministic.
const GA = {
  address1: '1 Peachtree St',
  city: 'Atlanta',
  state: 'Georgia',
  zip: '31' + String(Date.now() % 1000).padStart(3, '0'),
};

// The arithmetic this whole spec exists to prove, all of it produced by
// server code from Firestore data plus two vendor answers:
//   items   1 x $20.00 = 20.00   (fixture product, no offer targets it)
//   shipping          =  9.42    (cheapest of the fake carrier's two rates)
//   tax      20 x 0.08 =  1.60   (fake tax service default, Georgia only)
//   total             = 31.02
// Shipping is NOT discounted: the fixture config's freeShippingAmount is 100
// and this order is nowhere near it. Tax is on ITEMS only - shipping is not
// in the taxable amount, which the total below is what proves.
const EXPECTED = {
  subtotal: 20, shipping: 9.42, tax: 1.6, taxRate: 0.08, total: 31.02,
};

async function fakeVendorLog(vendor?: string): Promise<any[]> {
  const res = await fetch(`${FAKE_VENDORS}/__log`);
  const { requests } = await res.json();
  return vendor ? requests.filter((r: any) => r.vendor === vendor) : requests;
}

async function resetFakeVendors(): Promise<void> {
  const res = await fetch(`${FAKE_VENDORS}/__reset`, { method: 'POST' });
  expect(res.ok, 'fake-vendors must be running (it starts with npm run emu)').toBeTruthy();
}

/** Adds the fixture physical book to the cart from the web store page. */
async function addBookToCart(page: Page): Promise<void> {
  await page.goto(`${WEB_URL}/store`);
  // /store opens on the SERIES view, which contains no product links at all;
  // the flat grid is behind the Sort By select. Waiting for the seeded series
  // tile first is what proves the product stream has landed - selecting "All"
  // before that lands gets silently undone by applyCategoryFromUrl().
  await expect(page.getByRole('button', { name: 'M-7 Series' })).toBeVisible({ timeout: 30_000 });
  await page.selectOption('#storeSort', { label: 'All' });

  const card = page.locator('.product', { hasText: PRODUCT_TITLE });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'ADD' }).click();
  await expect(page.locator('.header__content-cart')).toContainText('(1)');
}

test.describe.configure({ mode: 'serial' });

test.describe('paid storefront checkout through the web UI', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    reseedEmulator();
  });

  test('a physical order is quoted, taxed and sent to PayPal, and the ' +
    'PayPal widget mounts against the server-created order', async ({ page }) => {
    await resetFakeVendors();
    await addBookToCart(page);

    await page.goto(`${WEB_URL}/checkout`);
    await page.locator('#checkout-firstName').fill(BUYER.firstName);
    await page.locator('#checkout-lastName').fill(BUYER.lastName);
    await page.locator('#checkout-email').fill(BUYER.email);
    await page.locator('#checkout-phone').fill(BUYER.phone);

    // A physical product makes isShippingAddressNeeded() true, so these
    // fields render - and a shipping address is what pulls in BOTH remaining
    // vendors (a rate quote, and a Georgia tax lookup).
    await page.locator('#checkout-address1').fill(GA.address1);
    await page.locator('#checkout-city').fill(GA.city);
    await page.selectOption('#checkout-state', GA.state);
    await page.locator('#checkout-zip').fill(GA.zip);

    const orderResponse = page.waitForResponse(
      (r) => r.url().includes('create_paypal_order'),
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    const response = await orderResponse;
    expect(response.ok(), 'create_paypal_order should succeed').toBeTruthy();

    const body = await response.json();
    expect(body.free).toBe(false);
    expect(body.orderId).toMatch(/^FAKEORDER/);
    // The server's breakdown - not the client's estimate. This is the number
    // the customer is about to be charged.
    expect(body.breakdown.subtotal).toBe(EXPECTED.subtotal);
    expect(body.breakdown.estimatedTaxes).toBe(EXPECTED.tax);
    expect(body.breakdown.taxRate).toBe(EXPECTED.taxRate);
    expect(body.breakdown.taxSource).toBe('service');
    expect(body.breakdown.shippingDiscount).toBe(0);
    expect(body.breakdown.total).toBe(EXPECTED.total);

    // The page stays on /checkout and hands over to PayPal, rather than
    // completing anything itself - a paid order can only finish by capturing
    // real payment.
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.locator('.paypal-background')).toBeVisible({ timeout: 30_000 });

    // The order is STAGED, not sold. pending_orders is written only after
    // PayPal accepts the order, and `purchases` stays empty until capture.
    const pending = await firestoreOwnerFetch(`pending_orders/${body.orderId}`);
    expect(pending.status).toBe(200);
    expect(pending.body.fields.status.stringValue).toBe('created');
    expect(pending.body.fields.amount.stringValue).toBe(EXPECTED.total.toFixed(2));
  });

  test('the shipping rate really came from the carrier, cheapest first',
    async () => {
      const calls = await fakeVendorLog('shipengine');
      const rateCalls = calls.filter((c) => c.op === 'rates');
      expect(rateCalls.length, 'checkout should have asked for a rate').toBe(1);
      // Weight is summed client-side from the cart (the fixture book is 1oz)
      // and has to survive the trip, or every quote is quietly wrong.
      expect(rateCalls[0].weight).toBe(1);

      // The fake answers with two rates, DESCENDING by price on purpose
      // (21.42 express, then 9.42 ground); ShippingService sorts ascending
      // and takes [0]. So the shipping figure that reached PayPal is the
      // whole assertion: 9.42 means the sort ran, 21.42 means it did not and
      // every shopper is being overquoted.
      const created = (await fakeVendorLog('paypal')).filter(
        (c) => c.op === 'create_order',
      );
      expect(created[0].breakdown.shipping.value).toBe(EXPECTED.shipping.toFixed(2));
      expect(created[0].breakdown.shipping.value).not.toBe('21.42');
    });

  test('the tax lookup was made for the buyer\'s own zip, and the amount ' +
    'PayPal was given matches what the page showed', async () => {
    const taxCalls = await fakeVendorLog('tax');
    // Exactly one lookup, for this run's own zip - so it cannot be a cache
    // hit left behind by another suite (see the note on GA above).
    expect(taxCalls.length).toBe(1);
    expect(taxCalls[0].zip).toBe(GA.zip);
    // The API key is a Secret Manager secret read server-side; it used to be
    // read by the browser. Its presence here is what proves it still is.
    expect(taxCalls[0].apikey).toBe('sent');

    const created = (await fakeVendorLog('paypal')).filter(
      (c) => c.op === 'create_order',
    );
    expect(created.length).toBe(1);
    expect(created[0].amount).toBe(EXPECTED.total.toFixed(2));
    expect(created[0].breakdown.item_total.value).toBe(EXPECTED.subtotal.toFixed(2));
    expect(created[0].breakdown.shipping.value).toBe(EXPECTED.shipping.toFixed(2));
    expect(created[0].breakdown.tax_total.value).toBe(EXPECTED.tax.toFixed(2));
    expect(created[0].items[0].name).toBe(PRODUCT_TITLE);
  });

  test('nothing was sold: no purchase exists for the buyer', async () => {
    // The point of the whole staged design. A created PayPal order is an
    // intent to pay, and until capture_paypal_order verifies the captured
    // amount there must be no Purchase, no receipt and no fulfilment.
    const res = await fetch(
      'http://127.0.0.1:8080/v1/projects/demo-impact/databases/(default)/documents:runQuery',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'purchases' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'email' },
                op: 'EQUAL',
                value: { stringValue: BUYER.email },
              },
            },
          },
        }),
      },
    );
    const rows = (await res.json()) as Array<{ document?: unknown }>;
    expect(rows.filter((r) => r.document).length).toBe(0);
  });
});
