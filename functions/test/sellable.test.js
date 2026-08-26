// Unit tests for the "may this be sold right now" rules (utils/sellable.ts).
//
// These two rules are deliberately DIFFERENT from each other, which is the
// whole reason they are worth pinning: a future reader who "tidies" them into
// one will either start refusing early-bird summit registrations or start
// selling delisted products again. Both regressions are silent.
//
// Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  isProductSellable,
  isEventRegistrationOpen,
} = require("../lib/utils/sellable");

test("a product is sellable only when isActive is EXACTLY true", () => {
  assert.equal(isProductSellable({isActive: true}), true);
  assert.equal(isProductSellable({isActive: false}), false);
});

test("a product with no isActive field is NOT sellable", () => {
  // Strictness is not arbitrary here - it mirrors the storefront's own
  // streamAllByValue('isActive', true), a Firestore equality that excludes
  // documents missing the field. A product the store will not list must not
  // be a product the checkout will sell.
  assert.equal(isProductSellable({}), false);
  assert.equal(isProductSellable({isActive: undefined}), false);
  assert.equal(isProductSellable({isActive: null}), false);
});

test("a product is not sellable on a truthy non-true value", () => {
  // "true" the string and 1 the number are the shapes a sloppy import or an
  // admin form leaves behind. Firestore equality would not match them either.
  assert.equal(isProductSellable({isActive: "true"}), false);
  assert.equal(isProductSellable({isActive: 1}), false);
});

test("a missing product document is not sellable", () => {
  assert.equal(isProductSellable(undefined), false);
  assert.equal(isProductSellable(null), false);
});

test("an active event accepts registrations", () => {
  assert.equal(isEventRegistrationOpen({isActive: true}), true);
});

test("an event with no isActive field accepts registrations", () => {
  // PERMISSIVE, unlike products - and not a decision made here. This is the
  // rule event-registration.functions.ts has always applied to the free
  // registration path; the paid path now shares it rather than keeping a
  // second, stricter copy.
  assert.equal(isEventRegistrationOpen({}), true);
});

test("an INACTIVE event is closed to registration", () => {
  assert.equal(isEventRegistrationOpen({isActive: false}), false);
});

test("an inactive event with earlyRegistration is still OPEN", () => {
  // The feature this permissiveness exists for: a summit can take sign-ups
  // before it goes live publicly, reachable only through the direct
  // /event-details/{id} link an early-bird campaign carries. Applying the
  // product rule to events would have broken exactly this.
  assert.equal(
    isEventRegistrationOpen({isActive: false, earlyRegistration: true}), true
  );
});

test("earlyRegistration must be EXACTLY true to reopen an inactive " +
  "event", () => {
  assert.equal(
    isEventRegistrationOpen({isActive: false, earlyRegistration: "yes"}), false
  );
  assert.equal(
    isEventRegistrationOpen({isActive: false, earlyRegistration: false}), false
  );
});

test("a missing event document is treated as open by the field rule " +
  "alone", () => {
  // Documented, not endorsed: the rule only answers "is registration open",
  // and callers check existence separately (event-registration.functions.ts
  // tests !eventSnap.exists first, checkout-pricing throws on a missing doc
  // before it gets here). Pinned so nobody relies on this for existence.
  assert.equal(isEventRegistrationOpen(undefined), true);
});
