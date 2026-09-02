"use strict";
// The guard that stops a lesson PDF being attached to a mail document it
// cannot fit inside. Untested until now, and the failure mode is not a crash:
// an oversized attachment would be REJECTED BY FIRESTORE after the PDF had
// been rendered, so the reader would simply never receive anything.
const test = require("node:test");
const assert = require("node:assert");

const {
  MAX_PDF_BYTES,
  exceedsAttachmentLimit,
  base64Size,
} = require("../lib/lesson-pdf/limits");

test("a real lesson is nowhere near the limit", () => {
  // Measured: lessons render at 11-15KB, the largest sent so far was 15KB.
  assert.equal(exceedsAttachmentLimit(15 * 1024), false);
});

test("the limit itself is allowed; one byte past it is not", () => {
  assert.equal(exceedsAttachmentLimit(MAX_PDF_BYTES), false);
  assert.equal(exceedsAttachmentLimit(MAX_PDF_BYTES + 1), true);
});

test("an empty render is not treated as oversized", () => {
  assert.equal(exceedsAttachmentLimit(0), false);
});

test("the ceiling leaves headroom under the 1MB document cap", () => {
  // The point of the number. base64 inflates by a third, and the document
  // carries an html body and fields besides the attachment - so the encoded
  // attachment has to stay comfortably below 1,048,576, not merely under it.
  const encoded = base64Size(MAX_PDF_BYTES);
  assert.ok(
    encoded < 1024 * 1024,
    `encoded ${encoded} must fit a 1MB document`
  );
  assert.ok(
    encoded < 1024 * 1024 * 0.95,
    `encoded ${encoded} should leave room for the body and fields`
  );
});

test("base64Size never under-reports", () => {
  // Rounding down here would be the dangerous direction - it would let
  // something through that Firestore then refuses.
  assert.ok(base64Size(1) >= 4);
  assert.ok(base64Size(3) >= 4);
  assert.ok(base64Size(4) >= 8);
});
