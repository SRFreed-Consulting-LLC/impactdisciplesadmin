#!/usr/bin/env node
// READ-ONLY: renders the compiled "Sales Receipt" template with a realistic
// order, so the whole email can be looked at the way a customer sees it -
// merge tags substituted, product table filled in.
//
// The compiled-template preview the converter writes is deliberately
// UNsubstituted (it shows where the tags are). This one answers the other
// question: does it actually look right once the order is in it.
//
//   node scripts/preview-receipt.js
"use strict";

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "output");
const {buildWebProductListHtml} = require("../functions/lib/transactional-emails");
const {renderEmailBody} = require("../functions/lib/utils/merge-tags.functions");

const templateFile = path.join(
  OUT_DIR, "template-preview-sales-receipt-impactdisciplesdev.html"
);
if (!fs.existsSync(templateFile)) {
  console.error(
    "  No compiled template preview yet. Run:\n" +
    "    node scripts/convert-template-to-builder.js --project=dev " +
    "--name=\"Sales Receipt\""
  );
  process.exit(1);
}
const tpl = fs.readFileSync(templateFile, "utf8");

// A cart with one of everything the table has a branch for.
const list = buildWebProductListHtml({
  cartItems: [
    {
      itemName: "Disciple-Making Field Guide", price: 20, orderQuantity: 2,
      img: {url: "https://x.test/a.png", name: "guide"},
    },
    {
      itemName: "Multiplication Primer (eBook)", price: 5, orderQuantity: 1,
      discount: 1, isEBook: true, eBookUrl: {url: "https://x.test/b.pdf"},
    },
    {itemName: "Field Guide (Library Edition)", price: 10, orderQuantity: 1,
      isDigitalBook: true},
  ],
  estimatedTaxes: 2.45,
  shippingRate: 8.5,
  shippingDiscount: 0,
  receipt: "IMP-2026-0042",
});

const out = renderEmailBody(tpl, {
  firstName: "Alex",
  lastName: "Rivera",
  email: "alex@example.test",
  product_list: list,
});

const target = path.join(OUT_DIR, "receipt-rendered-sample.html");
fs.writeFileSync(target, out, "utf8");

// The token used to sit inside <span> inside <p>. A <table> nested in a
// paragraph is hoisted out by every mail client, which is what broke the
// layout - so check what actually wraps it now.
const idx = tpl.indexOf("{{product_list}}");
const before = tpl.slice(Math.max(0, idx - 400), idx);
const lastOpenP = before.lastIndexOf("<p");
const lastCloseP = before.lastIndexOf("</p>");
const nestedInParagraph = lastOpenP > lastCloseP;

const leftover = out.match(/\{\{[^}]+\}\}/g) || [];

console.log(`  rendered   : ${target}`);
console.log(`  table present            : ${/<table role="presentation"/.test(out)}`);
console.log(`  token nested in a <p>    : ${nestedInParagraph}  (must be false)`);
console.log(`  unsubstituted tokens left: ${leftover.join(", ") || "none"}`);
console.log(`  totals in the output     : ${(out.match(/<b>[^<]*<\/b>/g) || []).slice(-2).join("  ")}`);
