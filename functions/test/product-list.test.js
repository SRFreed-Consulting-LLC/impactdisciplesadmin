// Tests for buildWebProductListHtml (transactional-emails.ts) - the order
// table interpolated into the "Sales Receipt" template as {{product_list}}.
//
// It had NO tests at all before 2026-08-27, which is how it kept a 7-column
// layout with ragged rows (header 7 cells, a plain item row 6, an eBook row
// 7) and 100px images that never fitted the 600px email it lands in.
//
// These assert INFORMATION, not markup: every number a customer needs, the
// download link they paid for, the confirmation id. Written that way on
// purpose so the layout can be changed again without rewriting the suite -
// what must not change is that nothing silently drops out of a receipt.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {buildWebProductListHtml} = require("../lib/transactional-emails");

const form = (overrides = {}) => ({
  cartItems: [],
  estimatedTaxes: 0,
  shippingRate: 0,
  shippingDiscount: 0,
  ...overrides,
});

const item = (overrides = {}) => ({
  itemName: "Field Guide",
  price: 20,
  orderQuantity: 2,
  ...overrides,
});

// -------------------------------------------------------------- line items

test("a line item shows its name, quantity, unit price and line total", () => {
  const html = buildWebProductListHtml(form({cartItems: [item()]}));
  assert.match(html, /Field Guide/);
  assert.match(html, /\$20\.00 each/, "unit price");
  assert.match(html, /\$40\.00/, "line total = 20 x 2");
  assert.match(html, />2</, "quantity");
});

test("a per-unit discount reduces the line total and is shown", () => {
  const html = buildWebProductListHtml(
    form({cartItems: [item({discount: 5})]}));
  assert.match(html, /less \$5\.00 each/);
  assert.match(html, /\$30\.00/, "line total = (20 - 5) x 2");
});

test("an item name is HTML-escaped", () => {
  const html = buildWebProductListHtml(
    form({cartItems: [item({itemName: "<script>x</script>"})]}));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("a missing image renders no <img> rather than a broken one", () => {
  const html = buildWebProductListHtml(form({cartItems: [item()]}));
  assert.doesNotMatch(html, /<img/, "no img element without a src");

  const withImg = buildWebProductListHtml(form({
    cartItems: [item({img: {url: "https://x.test/a.png", name: "A"}})],
  }));
  assert.match(withImg, /<img src="https:\/\/x\.test\/a\.png"/);
});

// ------------------------------------------------------------ digital goods

test("an eBook carries its download link", () => {
  const html = buildWebProductListHtml(form({
    cartItems: [item({isEBook: true, eBookUrl: {url: "https://x.test/b.pdf"}})],
  }));
  assert.match(html, /href="https:\/\/x\.test\/b\.pdf" download/);
  assert.match(html, /DOWNLOAD/);
});

test("a digital book adds the install-instructions block, once", () => {
  const html = buildWebProductListHtml(form({
    cartItems: [item({isDigitalBook: true}), item({isDigitalBook: true})],
  }));
  assert.match(html, /install-instructions/);
  assert.equal(
    (html.match(/library\.impactdisciples\.com\/install-instructions/g) || [])
      .length,
    1,
    "the instructions block appears once, not once per digital item"
  );
});

test("no digital book means no install block at all", () => {
  const html = buildWebProductListHtml(form({cartItems: [item()]}));
  assert.doesNotMatch(html, /install-instructions/);
});

// ----------------------------------------------------------------- totals

test("totals add tax and shipping and subtract both discounts", () => {
  const html = buildWebProductListHtml(form({
    cartItems: [item({discount: 5})], // (20-5) x 2 = 30, subtotal 40
    estimatedTaxes: 3,
    shippingRate: 10,
    shippingDiscount: 4,
  }));
  assert.match(html, /SUBTOTAL/);
  assert.match(html, /\$40\.00/, "subtotal is pre-discount");
  assert.match(html, /- \$10\.00/, "discount 5 x 2");
  assert.match(html, /\+ \$3\.00/, "taxes");
  assert.match(html, /\+ \$10\.00/, "shipping");
  assert.match(html, /- \$4\.00/, "shipping discount");
  // 40 - 10 + 3 + 10 - 4 = 39
  assert.match(html, /<b>\$39\.00<\/b>/, "order total");
});

test("zero taxes, shipping and discounts are omitted, not shown as $0", () => {
  const html = buildWebProductListHtml(form({cartItems: [item()]}));
  assert.doesNotMatch(html, /TAXES/);
  assert.doesNotMatch(html, /SHIPPING/);
  assert.doesNotMatch(html, /DISCOUNT/);
  assert.match(html, /SUBTOTAL/);
  assert.match(html, /TOTAL/);
});

test("the confirmation id appears only when the order has one", () => {
  assert.doesNotMatch(
    buildWebProductListHtml(form({cartItems: [item()]})),
    /Confirmation Id/
  );
  assert.match(
    buildWebProductListHtml(form({cartItems: [item()], receipt: "ABC-123"})),
    /Confirmation Id: <b>ABC-123<\/b>/
  );
});

test("an empty cart still produces a valid table with a zero total", () => {
  const html = buildWebProductListHtml(form());
  assert.match(html, /<table/);
  assert.match(html, /<\/table>/);
  assert.match(html, /<b>\$0\.00<\/b>/);
});

// ------------------------------------------------------- email-safe layout

test("every row spans the same four columns", () => {
  // The old markup's rows disagreed (7 / 6 / 7 cells), so columns never
  // lined up with their headings and totals drifted under QUANTITY.
  const html = buildWebProductListHtml(form({
    cartItems: [
      item(),
      item({isEBook: true, eBookUrl: {url: "https://x.test/b.pdf"}}),
    ],
    estimatedTaxes: 3,
    receipt: "R1",
  }));

  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  assert.ok(rows.length >= 5, `expected several rows, got ${rows.length}`);
  for (const row of rows) {
    const cells = (row.match(/<t[dh][\s>]/g) || []).length;
    const spans = [...row.matchAll(/colspan="(\d+)"/g)]
      .reduce((n, m) => n + (Number(m[1]) - 1), 0);
    assert.equal(cells + spans, 4, `row spans 4 columns: ${row.slice(0, 90)}`);
  }
});

test("the table carries attributes as well as styles (Outlook)", () => {
  const html = buildWebProductListHtml(form({cartItems: [item()]}));
  assert.match(html, /<table[^>]*width="100%"/);
  assert.match(html, /<table[^>]*cellpadding="0"/);
  assert.match(html, /<table[^>]*cellspacing="0"/);
  assert.match(html, /<table[^>]*border="0"/);
});

test("images are sized for a 600px email, not 100px tall", () => {
  const html = buildWebProductListHtml(form({
    cartItems: [item({img: {url: "https://x.test/a.png", name: "A"}})],
  }));
  assert.match(html, /width="64"/);
  assert.doesNotMatch(html, /height='100px'/);
  assert.doesNotMatch(html, /<\/img>/, "img is a void element");
});
