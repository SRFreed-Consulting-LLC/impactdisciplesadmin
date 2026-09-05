// THE MIRROR TEST scripts/lib/state-code.js AND country-code.js NEVER HAD.
//
// Both are deliberate duplicates of functions/src/utils/shipping-request.ts's
// stateCode() and countryCode(), for the same reason scripts/lib/tenancy.js
// duplicates the TypeScript tenancy seam: scripts/ is plain Node run straight
// from source, with no build step, so it can import neither the submodule's
// TypeScript nor functions/'s compiled output.
//
// tenancy.js has functions/test/tenancy-mirror.test.js. These two had
// nothing, and the drift here would be WORSE than tenancy's, for two reasons:
//
//   - It is asymmetric. scripts/lib/state-code.js knows things the functions
//     copy does not - the armed-forces codes AA/AE/AP, DC, the territories,
//     and compound junk like `MO 65355"`. So the two can disagree in one
//     direction only, and a reader comparing them casually would call the
//     difference intentional.
//   - It is silent. A script that normalises a state differently from the
//     shipping boundary writes data the vendor then rejects at Print Label
//     time - which is exactly the 2026-09-03 outage that made stateCode()
//     exist in the first place. The script reports "N documents fixed" and
//     exits zero either way.
//
// WHAT THIS DOES NOT ASSERT: that the two are identical. They are not, and
// should not be. It asserts they AGREE wherever both have an opinion - every
// state and country the shared enums declare - and it pins the extra codes
// the script alone handles, so removing one is a deliberate act rather than
// an accident.

const test = require("node:test");
const assert = require("node:assert");

const {toStateCode, STATES, EXTRA_CODES} =
  require("../../scripts/lib/state-code");
const {toCountryCode, COUNTRIES} = require("../../scripts/lib/country-code");
// The compiled functions copy - `npm --prefix functions run build` first.
const {stateCode, countryCode} = require("../lib/utils/shipping-request");

test("every state in the shared enum normalises the same on both sides", () => {
  const disagree = [];
  for (const [name, code] of Object.entries(STATES)) {
    // Both spellings a document might actually hold: the full name (which
    // `purchases` is 99.8% of) and the code (which `customers` is 85% of).
    for (const input of [name, code, name.toUpperCase(), code.toLowerCase()]) {
      const fromScript = toStateCode(input).value;
      const fromFunctions = stateCode(input);
      if (fromScript !== fromFunctions) {
        disagree.push(`${JSON.stringify(input)}: ` +
          `script=${fromScript} functions=${fromFunctions}`);
      }
    }
  }
  assert.deepEqual(disagree, [],
    "the script and the shipping boundary normalise a state differently - " +
    "whichever writes first, the vendor rejects the other");
});

test("every country in the enum normalises the same on both sides", () => {
  const disagree = [];
  for (const [name, code] of Object.entries(COUNTRIES)) {
    for (const input of [name, code, name.toLowerCase()]) {
      const fromScript = toCountryCode(input).value;
      const fromFunctions = countryCode(input);
      if (fromScript !== fromFunctions) {
        disagree.push(`${JSON.stringify(input)}: ` +
          `script=${fromScript} functions=${fromFunctions}`);
      }
    }
  }
  assert.deepEqual(disagree, [], "the two country normalisers disagree");
});

test("the codes only the script knows are still only the script's", () => {
  // AA/AE/AP are the armed-forces codes, plus DC and the territories. They
  // are NOT in the shared states enum, so the functions copy passes them
  // through unchanged while the script recognises them. That asymmetry is
  // intentional; this pins it so it cannot be lost or quietly widened.
  assert.ok(EXTRA_CODES.size > 0,
    "the script should know codes the enum does not");

  for (const code of EXTRA_CODES) {
    assert.equal(toStateCode(code).status, "ok",
      `the script stopped recognising ${code}`);
    // The functions copy has no opinion, so it returns the input untouched -
    // which is safe (ShipEngine wants two characters and gets two) and is
    // why the asymmetry has never bitten.
    assert.equal(stateCode(code), code,
      `the functions copy started rewriting ${code} - the two have diverged`);
  }
});

test("both sides leave something unrecognisable alone", () => {
  // A guess here is worse than a pass-through: it writes a plausible wrong
  // state onto a real address and the parcel goes to the wrong place.
  for (const junk of ["Zzz", "Not a state", "12345"]) {
    assert.equal(toStateCode(junk).value, junk);
    assert.equal(stateCode(junk), junk);
  }
});

test("both sides leave an empty state alone, by their own conventions", () => {
  // They express "nothing to do" DIFFERENTLY and both are right for their
  // job, which is worth pinning so nobody "aligns" them into a bug.
  //
  // The shipping boundary returns undefined, because it is building a vendor
  // payload and an absent field is what ShipEngine should receive. The script
  // returns the value unchanged with status "ok", because it is a migration
  // reporting what it would rewrite - and rewriting a blank state to anything
  // is worse than leaving it.
  for (const empty of ["", null, undefined, "   "]) {
    assert.equal(stateCode(empty), undefined,
      `the boundary should send no state for ${JSON.stringify(empty)}`);
    assert.equal(toStateCode(empty).status, "ok",
      `the script should leave ${JSON.stringify(empty)} alone`);
    assert.equal(toStateCode(empty).value, empty);
  }
  // countryCode defaults to US rather than undefined - the store ships from
  // and mostly to the States, and ShipEngine requires a country.
  assert.equal(countryCode(""), "US");
});

test("a name carrying an apostrophe survives the enum parser", () => {
  // The regression the mirror test caught on its first run. `[^"']+` as the
  // value class stopped at the apostrophe, so these two parsed as "Côte d"
  // and "Lao People" - keys no document holds - while the real spellings came
  // back unrecognised and were left as long strings where a vendor wants two
  // characters.
  assert.equal(toCountryCode("Côte d'Ivoire").value, "CI");
  assert.equal(toCountryCode("Lao People's Democratic Republic").value, "LA");
  // ...and the truncation is no longer accepted as if it were a real name.
  assert.equal(toCountryCode("Côte d").status, "unknown");
});
